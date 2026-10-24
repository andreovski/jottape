import { getJevConfig } from '@/lib/env';

import {
  type AccountOption,
  type CategoryOption,
  type ExtractedItem,
  type JevAnswers,
  type JevChoice,
  isFinanceIntent,
  NO_ACCOUNT,
  NO_CATEGORY,
  NO_LIST,
  optionKey,
  type TaskListOption,
} from './resolve';

// Jev (TypeSafe, System One): responde perguntas de escolha com a probabilidade de cada opção.
// Uma chamada por item, com todas as perguntas juntas (rodam em paralelo do lado deles).

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const TIMEOUT_MS = 6000;
const RETRIES = 2;

type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
};

const ACCOUNT_TYPE: Record<AccountOption['type'], string> = {
  WALLET: 'carteira (dinheiro vivo)',
  CHECKING: 'conta corrente',
  SAVINGS: 'poupança',
  CREDIT_CARD: 'cartão de crédito',
};

function accountCriteria(accounts: AccountOption[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  accounts.forEach((account, i) => {
    criteria[optionKey(i)] = `${account.name} (${ACCOUNT_TYPE[account.type]})`;
  });
  criteria[NO_ACCOUNT] = 'The request does not say which account or card';
  return criteria;
}

export interface JevOptions {
  accounts: AccountOption[];
  categories: CategoryOption[];
  lists: TaskListOption[];
}

/** As perguntas de um item. Instruções em inglês (língua principal do Jev); o pedido vai em pt-BR. */
export function buildQuestions(
  item: ExtractedItem,
  { accounts, categories, lists }: JevOptions
): Record<string, ChoiceQuestion> {
  const questions: Record<string, ChoiceQuestion> = {
    kind: {
      type: 'choice',
      instructions:
        'The user wrote this request (in Brazilian Portuguese) to an app for personal finance, calendar and to-dos. What does the user want to record?',
      criteria: {
        expense: 'Money spent: a purchase, a bill, a payment for something',
        income: 'Money received: salary, a sale, a refund, a transfer from someone else',
        transfer:
          "Money moved between the user's own accounts, a deposit into savings or paying a credit card bill",
        event:
          'A calendar appointment at a set day and time: a doctor visit, a meeting, a class, a trip, a birthday',
        task: 'Something to do or to be reminded of, not an appointment: a to-do, an errand, a chore',
      },
    },
  };

  if (item.intent === 'task' && lists.length > 0) {
    const criteria: Record<string, string> = {};
    lists.forEach((list, i) => {
      criteria[optionKey(i)] = list.name;
    });
    criteria[NO_LIST] = 'The request does not say which list';
    questions.list = {
      type: 'choice',
      instructions: 'Which of the user to-do lists does this task belong to?',
      criteria,
    };
  }
  if (!isFinanceIntent(item.intent) || accounts.length === 0) return questions;

  questions.account = {
    type: 'choice',
    instructions:
      'Which of the user accounts or cards does the money come out of (or go into, for income)?',
    criteria: accountCriteria(accounts),
  };
  if (item.intent === 'transfer') {
    questions.toAccount = {
      type: 'choice',
      instructions: 'Which of the user accounts receives the money in this transfer?',
      criteria: accountCriteria(accounts),
    };
  } else if (categories.length > 0) {
    const criteria: Record<string, string> = {};
    categories.forEach((category, i) => {
      criteria[optionKey(i)] =
        `${category.name} (${category.kind === 'INCOME' ? 'income' : 'expense'})`;
    });
    criteria[NO_CATEGORY] = 'None of these categories fits';
    questions.category = {
      type: 'choice',
      instructions: 'Which budget category fits this request best?',
      criteria,
    };
  }
  return questions;
}

interface JevResponse {
  answers: Record<
    string,
    { type: string; choice?: string; probabilities?: Record<string, number> }
  >;
  usage?: { input_tokens?: number };
}

export interface JevResult {
  answers: JevAnswers;
  inputTokens: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Uma chamada ao Jev. Sem a chave, null; erro de rede ou de resposta sobe. */
async function callJev(
  state: Record<string, string>,
  questions: Record<string, ChoiceQuestion>
): Promise<JevResponse | null> {
  const config = getJevConfig();
  if (!config) return null;

  const body = JSON.stringify({ model: config.model, state, questions });
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if ((response.status === 429 || response.status === 529) && attempt < RETRIES) {
      await sleep(300 * 2 ** attempt);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Jev ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return (await response.json()) as JevResponse;
  }
  return null;
}

function choiceOf(data: JevResponse, name: string): JevChoice | undefined {
  const answer = data.answers?.[name];
  if (!answer?.choice || !answer.probabilities) return undefined;
  return { choice: answer.choice, probabilities: answer.probabilities };
}

/** Pergunta ao Jev sobre um item. Sem a chave, ou se ele falhar, devolve null (o Haiku decide sozinho). */
export async function askJev(item: ExtractedItem, options: JevOptions): Promise<JevResult | null> {
  const data = await callJev({ request: item.excerpt }, buildQuestions(item, options));
  if (!data) return null;
  return {
    answers: {
      kind: choiceOf(data, 'kind'),
      account: choiceOf(data, 'account'),
      toAccount: choiceOf(data, 'toAccount'),
      category: choiceOf(data, 'category'),
      list: choiceOf(data, 'list'),
    },
    inputTokens: data.usage?.input_tokens ?? 0,
  };
}

export interface JevCategoryResult {
  /** Probabilidade de cada categoria, pelo id (a de "nenhuma" fica de fora). */
  probabilities: Map<string, number>;
  inputTokens: number;
}

/**
 * A categoria de um lançamento que veio do banco (revisão), entre as do mesmo tipo. `labels` são
 * os nomes como a pessoa vê ("Transferência › Pix").
 */
export async function askJevCategory(
  movement: string,
  categories: { id: string; label: string; kind: 'INCOME' | 'EXPENSE' }[]
): Promise<JevCategoryResult | null> {
  if (categories.length === 0) return null;
  const criteria: Record<string, string> = {};
  categories.forEach((category, i) => {
    criteria[optionKey(i)] =
      `${category.label} (${category.kind === 'INCOME' ? 'income' : 'expense'})`;
  });
  criteria[NO_CATEGORY] = 'None of these categories fits';
  const data = await callJev(
    { movement },
    {
      category: {
        type: 'choice',
        instructions:
          'This is a transaction imported from the user bank statement (in Brazilian Portuguese): a title, the raw text from the bank, the amount and whether money went out or came in. Which of the user budget categories fits it best?',
        criteria,
      },
    }
  );
  const choice = data && choiceOf(data, 'category');
  if (!data || !choice) return null;
  const probabilities = new Map<string, number>();
  categories.forEach((category, i) => {
    const probability = choice.probabilities[optionKey(i)];
    if (probability !== undefined) probabilities.set(category.id, probability);
  });
  return { probabilities, inputTokens: data.usage?.input_tokens ?? 0 };
}
