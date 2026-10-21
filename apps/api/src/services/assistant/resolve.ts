import { addDays } from '@jottape/finance-engine';
import type {
  AssistantDraft,
  AssistantEventDraft,
  AssistantMissing,
  AssistantTaskDraft,
  AssistantTransactionDraft,
  AssistantUncertain,
} from '@jottape/schemas';

// Funções puras do Assistente: do que o Haiku leu e do que o Jev escolheu até o rascunho (de
// lançamento, evento ou tarefa), com o score que decide se ele salva sozinho.

/** Com score a partir daqui e nada faltando, o lançamento é salvo sem perguntar (com Desfazer). */
export const AUTO_SAVE_SCORE = 0.85;
/** Sem o Jev, a confiança do Haiku sozinho não passa disso: nada é salvo sem o usuário ver. */
export const MODEL_ONLY_CAP = 0.8;
/** Conta ou categoria escolhida pelo Jev quando o pedido não nomeia nenhuma. */
const JEV_GUESS_MIN = 0.6;
/** Conta mais usada, sugerida quando nada aponta para uma conta: sempre pede confirmação. */
const FALLBACK_ACCOUNT_CONFIDENCE = 0.5;

export type Intent =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'event'
  | 'task'
  | 'question'
  | 'change'
  | 'other';
export type FinanceIntent = 'expense' | 'income' | 'transfer';

/** Um pedido como o Haiku leu (um texto pode ter vários: "30 no uber e 50 no mercado"). */
export interface ExtractedItem {
  intent: Intent;
  /** O trecho do texto que fala deste item: é o que o Jev lê. */
  excerpt: string;
  amountCents: number | null;
  description: string;
  date: string | null;
  account: string | null;
  toAccount: string | null;
  category: string | null;
  installments: number | null;
  /** "HH:MM" do início (evento) ou do prazo (tarefa). */
  time: string | null;
  endTime: string | null;
  allDay: boolean;
  /** Lista de tarefas que o pedido nomeou. */
  list: string | null;
  location: string | null;
  confidence: number;
}

export interface AccountOption {
  id: string;
  name: string;
  type: 'WALLET' | 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD';
}

export interface TaskListOption {
  id: string;
  name: string;
}

export interface CategoryOption {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
}

/** Resposta de uma pergunta "choice" do Jev: a probabilidade de cada opção. */
export interface JevChoice {
  choice: string;
  probabilities: Record<string, number>;
}

export interface JevAnswers {
  kind?: JevChoice;
  account?: JevChoice;
  toAccount?: JevChoice;
  category?: JevChoice;
  list?: JevChoice;
}

export interface Resolution {
  draft: AssistantDraft;
  missing: AssistantMissing[];
  uncertain: AssistantUncertain[];
  score: number;
  autoSave: boolean;
}

export const isFinanceIntent = (intent: Intent): intent is FinanceIntent =>
  intent === 'expense' || intent === 'income' || intent === 'transfer';

/** O que o Assistente sabe criar (perguntas e mudanças seguem por outro caminho). */
export const isActionIntent = (intent: Intent): intent is FinanceIntent | 'event' | 'task' =>
  isFinanceIntent(intent) || intent === 'event' || intent === 'task';

const KIND: Record<FinanceIntent, AssistantTransactionDraft['kind']> = {
  expense: 'EXPENSE',
  income: 'INCOME',
  transfer: 'TRANSFER',
};

/** Chave da opção no Jev: o nome não vai como chave (pode repetir e ter acento). */
export const optionKey = (index: number) => `opcao_${index + 1}`;
export const NO_ACCOUNT = 'nao_informada';
export const NO_CATEGORY = 'nenhuma';
export const NO_LIST = 'entrada';

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Acha pelo nome: igual, depois um contendo o outro. Ambíguo (dois iguais) não conta. */
export function matchByName<T extends { name: string }>(
  options: T[],
  name: string | null
): T | null {
  if (!name) return null;
  const wanted = normalize(name);
  if (!wanted) return null;
  const exact = options.filter((o) => normalize(o.name) === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const partial = options.filter((o) => {
    const candidate = normalize(o.name);
    return candidate.length > 0 && (candidate.includes(wanted) || wanted.includes(candidate));
  });
  return partial.length === 1 ? partial[0] : null;
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Data lida pelo Haiku, se fizer sentido (até um ano para cada lado); senão, hoje. */
export function resolveDate(value: string | null, today: string): string {
  if (!value || !isIsoDate(value)) return today;
  if (value < addDays(today, -366) || value > addDays(today, 366)) return today;
  return value;
}

interface Pick<T> {
  value: T | null;
  confidence: number;
}

/**
 * Junta o que o Haiku nomeou com o que o Jev escolheu. A confiança é a probabilidade que o Jev deu
 * ao valor final: se os dois concordam ela é alta, se discordam ela cai sozinha.
 */
function pickOption<T extends { id: string }>(
  options: T[],
  named: T | null,
  jev: JevChoice | undefined,
  noneKey: string
): Pick<T> {
  const keyOf = (option: T) => optionKey(options.indexOf(option));
  if (named) {
    if (!jev) return { value: named, confidence: 1 };
    return { value: named, confidence: jev.probabilities[keyOf(named)] ?? 0 };
  }
  if (jev && jev.choice !== noneKey) {
    const index = Number(jev.choice.replace('opcao_', '')) - 1;
    const guess = options[index];
    const probability = jev.probabilities[jev.choice] ?? 0;
    if (guess && probability >= JEV_GUESS_MIN) return { value: guess, confidence: probability };
  }
  return { value: null, confidence: 0 };
}

/** Score e decisão a partir da confiança de cada campo (a menor manda). */
function finish(
  draft: AssistantDraft,
  missing: AssistantMissing[],
  confidences: Partial<Record<AssistantUncertain, number>>,
  item: ExtractedItem,
  withJev: boolean
): Resolution {
  const modelConfidence = Math.max(0, Math.min(1, item.confidence));
  const uncertain = (Object.keys(confidences) as AssistantUncertain[]).filter(
    (field) => (confidences[field] ?? 1) < AUTO_SAVE_SCORE
  );
  const fieldScore = Math.min(1, ...Object.values(confidences).map((c) => c ?? 1));
  const base = withJev
    ? Math.min(fieldScore, modelConfidence)
    : Math.min(fieldScore, modelConfidence, MODEL_ONLY_CAP);
  const score = Math.round(Math.max(0, Math.min(1, base)) * 100) / 100;
  return {
    draft,
    missing,
    uncertain,
    score,
    autoSave: missing.length === 0 && score >= AUTO_SAVE_SCORE,
  };
}

/** Tipo: o do Haiku, conferido pelo Jev (a probabilidade que ele deu a esse tipo). */
const kindConfidence = (item: ExtractedItem, jev: JevAnswers | null) =>
  jev?.kind ? (jev.kind.probabilities[item.intent] ?? 0) : 1;

const isTime = (value: string | null): value is string =>
  Boolean(value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const timeOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export interface ResolveInput {
  item: ExtractedItem & { intent: FinanceIntent };
  accounts: AccountOption[];
  categories: CategoryOption[];
  jev: JevAnswers | null;
  today: string;
  /** Conta que o usuário mais usa: sugestão quando o pedido não diz qual. */
  usualAccountId: string | null;
}

export function resolveItem({
  item,
  accounts,
  categories,
  jev,
  today,
  usualAccountId,
}: ResolveInput): Resolution {
  const kind = KIND[item.intent];
  const confidences: Partial<Record<AssistantUncertain, number>> = {};
  confidences.kind = kindConfidence(item, jev);

  // Conta de origem (no cartão, o próprio cartão).
  const sources = kind === 'INCOME' ? accounts.filter((a) => a.type !== 'CREDIT_CARD') : accounts;
  let account: Pick<AccountOption>;
  if (sources.length === 1) {
    account = { value: sources[0], confidence: 1 };
  } else {
    account = pickOption(accounts, matchByName(accounts, item.account), jev?.account, NO_ACCOUNT);
    if (account.value && !sources.includes(account.value)) account = { value: null, confidence: 0 };
    if (!account.value) {
      const usual = sources.find((a) => a.id === usualAccountId);
      if (usual) account = { value: usual, confidence: FALLBACK_ACCOUNT_CONFIDENCE };
    }
  }
  confidences.account = account.confidence;

  // Destino da transferência.
  let toAccount: Pick<AccountOption> = { value: null, confidence: 1 };
  if (kind === 'TRANSFER') {
    toAccount = pickOption(
      accounts,
      matchByName(accounts, item.toAccount),
      jev?.toAccount,
      NO_ACCOUNT
    );
    if (toAccount.value && toAccount.value.id === account.value?.id) {
      toAccount = { value: null, confidence: 0 };
    }
    confidences.toAccount = toAccount.confidence;
  }

  // Categoria (não tem em transferência). Sem categoria o lançamento existe: não pesa no score.
  let category: Pick<CategoryOption> = { value: null, confidence: 1 };
  if (kind !== 'TRANSFER') {
    category = pickOption(
      categories,
      matchByName(categories, item.category),
      jev?.category,
      NO_CATEGORY
    );
    if (category.value && category.value.kind !== kind) category = { value: null, confidence: 1 };
    if (category.value) confidences.category = category.confidence;
  }

  const amountCents =
    item.amountCents && Number.isInteger(item.amountCents) && item.amountCents > 0
      ? item.amountCents
      : null;
  const installments =
    kind === 'EXPENSE' &&
    item.installments &&
    Number.isInteger(item.installments) &&
    item.installments >= 2 &&
    item.installments <= 72
      ? item.installments
      : null;
  const description =
    item.description.trim().slice(0, 120) ||
    category.value?.name ||
    (kind === 'INCOME' ? 'Receita' : kind === 'TRANSFER' ? 'Transferência' : 'Despesa');

  const draft: AssistantTransactionDraft = {
    type: 'transaction',
    kind,
    amountCents,
    date: resolveDate(item.date, today),
    accountId: account.value?.id ?? null,
    toAccountId: toAccount.value?.id ?? null,
    categoryId: category.value?.id ?? null,
    description,
    installments,
  };

  const missing: AssistantMissing[] = [];
  if (!amountCents) missing.push('amount');
  if (!draft.accountId) missing.push('account');
  if (kind === 'TRANSFER' && !draft.toAccountId) missing.push('toAccount');

  return finish(draft, missing, confidences, item, Boolean(jev));
}

/** Evento: sem horário e sem ser o dia todo, falta o horário. Sem fim, dura uma hora. */
export function resolveEvent({
  item,
  jev,
  today,
}: {
  item: ExtractedItem;
  jev: JevAnswers | null;
  today: string;
}): Resolution {
  const startTime = isTime(item.time) ? item.time : null;
  const allDay = item.allDay || false;
  let endTime: string | null = null;
  if (startTime && !allDay) {
    const start = minutesOf(startTime);
    const end = isTime(item.endTime) ? minutesOf(item.endTime) : start + 60;
    // Termina no mesmo dia (o Assistente não cria evento que vira a noite).
    endTime = timeOf(Math.min(end > start ? end : start + 60, 23 * 60 + 59));
  }
  const draft: AssistantEventDraft = {
    type: 'event',
    title: item.description.trim().slice(0, 200) || 'Evento',
    date: resolveDate(item.date, today),
    startTime: allDay ? null : startTime,
    endTime,
    allDay,
    location: item.location?.trim().slice(0, 300) || null,
  };
  const missing: AssistantMissing[] = !allDay && !startTime ? ['time'] : [];
  return finish(draft, missing, { kind: kindConfidence(item, jev) }, item, Boolean(jev));
}

/** Tarefa: sem lista vai para a Entrada; horário só vale com data. */
export function resolveTask({
  item,
  lists,
  jev,
  today,
}: {
  item: ExtractedItem;
  lists: TaskListOption[];
  jev: JevAnswers | null;
  today: string;
}): Resolution {
  const confidences: Partial<Record<AssistantUncertain, number>> = {
    kind: kindConfidence(item, jev),
  };
  const named = matchByName(lists, item.list);
  let list: Pick<TaskListOption> = { value: null, confidence: 1 };
  if (named) {
    list = pickOption(lists, named, jev?.list, NO_LIST);
  } else if (item.list) {
    // Nomeou uma lista que não achamos: a do Jev, se ele tiver certeza; senão a Entrada, marcada.
    list = pickOption(lists, null, jev?.list, NO_LIST);
    if (!list.value) list = { value: null, confidence: 0.5 };
  }
  confidences.list = list.confidence;

  const date = item.date ? resolveDate(item.date, today) : null;
  const draft: AssistantTaskDraft = {
    type: 'task',
    title: item.description.trim().slice(0, 300) || 'Tarefa',
    date,
    time: date && isTime(item.time) ? item.time : null,
    listId: list.value?.id ?? null,
  };
  return finish(draft, [], confidences, item, Boolean(jev));
}

/** O que falta, em português, para a resposta do Assistente. */
export function describeMissing(missing: AssistantMissing[]): string {
  const names: Record<AssistantMissing, string> = {
    amount: 'o valor',
    account: 'a conta',
    toAccount: 'a conta de destino',
    time: 'o horário',
  };
  const parts = missing.map((m) => names[m]);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

/** O rascunho de um item que cria algo (lançamento, evento ou tarefa). */
export function resolveAction(input: {
  /** Um item com isActionIntent. */
  item: ExtractedItem;
  accounts: AccountOption[];
  categories: CategoryOption[];
  lists: TaskListOption[];
  jev: JevAnswers | null;
  today: string;
  usualAccountId: string | null;
}): Resolution {
  const { item, jev, today } = input;
  if (item.intent === 'event') return resolveEvent({ item, jev, today });
  if (item.intent === 'task') return resolveTask({ item, lists: input.lists, jev, today });
  return resolveItem({
    item: item as ExtractedItem & { intent: FinanceIntent },
    accounts: input.accounts,
    categories: input.categories,
    jev,
    today,
    usualAccountId: input.usualAccountId,
  });
}
