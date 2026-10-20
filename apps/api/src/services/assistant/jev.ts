import { getJevConfig } from '@/lib/env';

import {
  type AccountOption,
  type CategoryOption,
  type ExtractedItem,
  type JevAnswers,
  type JevChoice,
  NO_ACCOUNT,
  NO_CATEGORY,
  optionKey,
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

/** As perguntas de um item. Instruções em inglês (língua principal do Jev); o pedido vai em pt-BR. */
export function buildQuestions(
  item: ExtractedItem,
  accounts: AccountOption[],
  categories: CategoryOption[]
): Record<string, ChoiceQuestion> {
  const questions: Record<string, ChoiceQuestion> = {
    kind: {
      type: 'choice',
      instructions:
        'The user wrote this request (in Brazilian Portuguese) to a personal finance app. What kind of money movement is it?',
      criteria: {
        expense: 'Money spent: a purchase, a bill, a payment for something',
        income: 'Money received: salary, a sale, a refund, a transfer from someone else',
        transfer:
          "Money moved between the user's own accounts, a deposit into savings or paying a credit card bill",
      },
    },
    account: {
      type: 'choice',
      instructions:
        'Which of the user accounts or cards does the money come out of (or go into, for income)?',
      criteria: accountCriteria(accounts),
    },
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

/** Pergunta ao Jev sobre um item. Sem a chave, ou se ele falhar, devolve null (o Haiku decide sozinho). */
export async function askJev(
  item: ExtractedItem,
  accounts: AccountOption[],
  categories: CategoryOption[]
): Promise<JevResult | null> {
  const config = getJevConfig();
  if (!config) return null;

  const body = JSON.stringify({
    model: config.model,
    state: { request: item.excerpt },
    questions: buildQuestions(item, accounts, categories),
  });

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
    const data = (await response.json()) as JevResponse;
    const choice = (name: string): JevChoice | undefined => {
      const answer = data.answers?.[name];
      if (!answer?.choice || !answer.probabilities) return undefined;
      return { choice: answer.choice, probabilities: answer.probabilities };
    };
    return {
      answers: {
        kind: choice('kind'),
        account: choice('account'),
        toAccount: choice('toAccount'),
        category: choice('category'),
      },
      inputTokens: data.usage?.input_tokens ?? 0,
    };
  }
  return null;
}
