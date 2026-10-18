import {
  addMonthsToMonth,
  buildRRule,
  monthRange,
  splitInstallments,
} from '@jottape/finance-engine';
import type {
  AccountResponse,
  AccountType,
  BudgetStatusResponse,
  CategoryResponse,
  ForecastResponse,
  InvoiceResponse,
  TransactionKind,
  TransactionResponse,
} from '@jottape/schemas';

import { money } from '@/lib/format';

// Regras puras da seção Finanças (testadas em finance-utils.test.ts). Nada aqui toca em React.

// ------------------------------------------------------------------ meses

export const isMonth = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export const monthOfDay = (day: string) => day.slice(0, 7);

/** Mês da URL, ou o mês de hoje quando ela não traz um válido. */
export function resolveMonth(value: unknown, today: string): string {
  return isMonth(value) ? value : monthOfDay(today);
}

export const shiftMonth = (month: string, delta: number) => addMonthsToMonth(month, delta);

export const lastDayOfMonth = (month: string) => monthRange(month).last;

// ------------------------------------------------------------------ lançamentos

/** Valor com sinal do ponto de vista do extrato (ou de uma conta, quando `accountId` vem). */
export function signedAmount(tx: TransactionResponse, accountId?: string): number {
  if (tx.kind === 'INCOME') return tx.amountCents;
  if (tx.kind === 'EXPENSE') return -tx.amountCents;
  if (!accountId) return 0;
  if (tx.toAccountId === accountId) return tx.amountCents;
  if (tx.accountId === accountId) return -tx.amountCents;
  return 0;
}

export interface DayGroup {
  date: string;
  items: TransactionResponse[];
  /** Soma do dia (transferências entram só quando há conta). */
  totalCents: number;
}

/** Agrupa por dia, do mais recente para o mais antigo; mantém a ordem da API dentro do dia. */
export function groupByDay(transactions: TransactionResponse[], accountId?: string): DayGroup[] {
  const map = new Map<string, TransactionResponse[]>();
  for (const tx of transactions) {
    const list = map.get(tx.date);
    if (list) list.push(tx);
    else map.set(tx.date, [tx]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, items]) => ({
      date,
      items,
      totalCents: items.reduce((sum, tx) => sum + signedAmount(tx, accountId), 0),
    }));
}

export interface Totals {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  plannedIncomeCents: number;
  plannedExpenseCents: number;
}

/**
 * Entradas e saídas de uma lista. Sem conta, transferências não contam (o dinheiro só muda de
 * lugar); com conta, a que chega é entrada e a que sai é saída. Os previstos entram nos totais e
 * também aparecem separados.
 */
export function totalsOf(transactions: TransactionResponse[], accountId?: string): Totals {
  const totals: Totals = {
    incomeCents: 0,
    expenseCents: 0,
    netCents: 0,
    plannedIncomeCents: 0,
    plannedExpenseCents: 0,
  };
  for (const tx of transactions) {
    const value = signedAmount(tx, accountId);
    if (value > 0) {
      totals.incomeCents += value;
      if (tx.status === 'PLANNED') totals.plannedIncomeCents += value;
    } else if (value < 0) {
      totals.expenseCents -= value;
      if (tx.status === 'PLANNED') totals.plannedExpenseCents -= value;
    }
  }
  totals.netCents = totals.incomeCents - totals.expenseCents;
  return totals;
}

export type StatementFilter = 'all' | 'income' | 'expense' | 'planned';

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function filterTransactions(
  transactions: TransactionResponse[],
  filter: StatementFilter,
  search = '',
  accountId?: string
): TransactionResponse[] {
  const term = normalize(search);
  return transactions.filter((tx) => {
    if (filter === 'planned' && tx.status !== 'PLANNED') return false;
    if (filter === 'income' && signedAmount(tx, accountId) <= 0) return false;
    if (filter === 'expense' && signedAmount(tx, accountId) >= 0) return false;
    if (term && !normalize(`${tx.description} ${tx.notes ?? ''}`).includes(term)) return false;
    return true;
  });
}

/** "2/3" de uma parcela, ou null. */
export function installmentLabel(
  tx: Pick<TransactionResponse, 'installmentNumber' | 'installmentTotal'>
) {
  if (!tx.installmentNumber || !tx.installmentTotal) return null;
  return `${tx.installmentNumber}/${tx.installmentTotal}`;
}

/** "3× de R$ 33,34" (a parcela maior, que é a primeira). */
export function installmentPreview(totalCents: number, count: number): string | null {
  if (!Number.isInteger(totalCents) || totalCents <= 0 || count < 2) return null;
  const parts = splitInstallments(totalCents, count);
  return `${count}× de ${money(parts[0])}`;
}

export const defaultStatus = (date: string, today: string) => (date <= today ? 'DONE' : 'PLANNED');

// ------------------------------------------------------------------ categorias

/** Subcategoria sem cor ou ícone usa os da mãe. */
export function styledCategory(
  category: CategoryResponse | null | undefined,
  all: CategoryResponse[]
): CategoryResponse | null {
  if (!category) return null;
  if (category.color && category.icon) return category;
  const parent = category.parentId ? all.find((c) => c.id === category.parentId) : undefined;
  if (!parent) return category;
  return { ...category, color: category.color ?? parent.color, icon: category.icon ?? parent.icon };
}

export function categoryLabel(category: CategoryResponse, all: CategoryResponse[]): string {
  const parent = category.parentId ? all.find((c) => c.id === category.parentId) : undefined;
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

/** Opções do seletor: só do tipo pedido, cada mãe seguida das filhas. */
export function categoryOptions(
  all: CategoryResponse[],
  kind: TransactionKind
): { value: string; label: string }[] {
  if (kind === 'TRANSFER') return [];
  const ofKind = all.filter((c) => c.kind === kind);
  const byName = (a: CategoryResponse, b: CategoryResponse) =>
    a.name.localeCompare(b.name, 'pt-BR');
  const ids = new Set(ofKind.map((c) => c.id));
  const roots = ofKind.filter((c) => !c.parentId || !ids.has(c.parentId)).sort(byName);
  return roots.flatMap((root) => [
    { value: root.id, label: categoryLabel(root, all) },
    ...ofKind
      .filter((c) => c.parentId === root.id)
      .sort(byName)
      .map((child) => ({ value: child.id, label: categoryLabel(child, all) })),
  ]);
}

export interface Slice {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string | null;
  category: CategoryResponse | null;
  totalCents: number;
  /** 0–100. */
  percent: number;
}

/** Fatias da rosca de despesas, da maior para a menor. */
export function categorySlices(
  totals: { categoryId: string | null; totalCents: number }[],
  all: CategoryResponse[]
): Slice[] {
  const positive = totals.filter((t) => t.totalCents > 0);
  const sum = positive.reduce((acc, t) => acc + t.totalCents, 0);
  return positive
    .map((t) => {
      const category = styledCategory(
        all.find((c) => c.id === t.categoryId),
        all
      );
      return {
        categoryId: t.categoryId,
        name: category ? categoryLabel(category, all) : 'Sem categoria',
        color: category?.color ?? 'var(--gray)',
        icon: category?.icon ?? null,
        category,
        totalCents: t.totalCents,
        percent: sum ? (t.totalCents / sum) * 100 : 0,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);
}

// ------------------------------------------------------------------ comparação e números

/** "12% menos que setembro", "Igual a setembro" ou null quando não há base. */
export function comparisonText(current: number, previous: number, previousName: string) {
  if (previous <= 0) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return `Igual a ${previousName}`;
  return `${Math.abs(change)}% ${change > 0 ? 'mais' : 'menos'} que ${previousName}`;
}

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** Eixo do gráfico, sem o "R$" (como no app Bolsa): "500", "2 mil", "1,5 mi", "−300". */
export function compactMoney(cents: number): string {
  const reais = Math.abs(cents) / 100;
  const sign = cents < 0 ? '−' : '';
  if (reais >= 1_000_000) return `${sign}${decimal.format(reais / 1_000_000)} mi`;
  if (reais >= 1_000) return `${sign}${decimal.format(reais / 1_000)} mil`;
  return `${sign}${Math.round(reais)}`;
}

/** Percentual curto para a legenda: "42%", "0,5%". */
export function percentLabel(percent: number) {
  if (percent > 0 && percent < 1) return `${decimal.format(percent)}%`;
  return `${Math.round(percent)}%`;
}

// ------------------------------------------------------------------ previsão

/**
 * Posição (0 = topo, 1 = base) do zero numa área de gráfico cujo eixo vai do maior ao menor valor.
 * É o `offset` em que o gradiente troca de verde para vermelho.
 */
export function zeroCrossingOffset(values: number[]): number {
  if (!values.length) return 1;
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max <= 0) return 0;
  if (min >= 0) return 1;
  return max / (max - min);
}

/** Saldo previsto no último dia do mês (ou no último dia disponível). */
export function forecastAt(forecast: ForecastResponse | undefined, day: string) {
  if (!forecast?.days.length) return null;
  const exact = forecast.days.find((d) => d.date === day);
  if (exact) return exact;
  const before = forecast.days.filter((d) => d.date <= day);
  return before.at(-1) ?? forecast.days.at(-1) ?? null;
}

/** Datas que aparecem no eixo X: poucas e espalhadas. */
export function axisTicks(dates: string[], count = 4): string[] {
  if (dates.length <= count) return dates;
  const step = (dates.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => dates[Math.round(i * step)]);
}

// ------------------------------------------------------------------ contas

export const ACCOUNT_DEFAULT_COLORS: Record<AccountType, string> = {
  CHECKING: 'var(--blue)',
  SAVINGS: 'var(--mint)',
  WALLET: 'var(--orange)',
  CREDIT_CARD: 'var(--indigo)',
};

export const accountColor = (account: Pick<AccountResponse, 'color' | 'type'>) =>
  account.color ?? ACCOUNT_DEFAULT_COLORS[account.type];

/** Gradiente do cartão: a cor da conta descendo para um tom mais escuro dela mesma. */
export function cardGradient(color: string) {
  return `linear-gradient(145deg, color-mix(in srgb, ${color} 88%, white) 0%, ${color} 38%, color-mix(in srgb, ${color} 62%, black) 100%)`;
}

/** Saldo disponível: contas que não são cartão e não estão arquivadas. */
export function availableBalance(accounts: AccountResponse[]) {
  return accounts
    .filter((a) => a.type !== 'CREDIT_CARD' && !a.archived)
    .reduce((sum, a) => sum + a.balanceCents, 0);
}

// ------------------------------------------------------------------ orçamentos

export interface BudgetBar {
  /** Larguras em % da barra (somam no máximo 100). */
  spentWidth: number;
  plannedWidth: number;
  level: 'ok' | 'warn' | 'over';
  remainingCents: number;
}

export function budgetBar(
  budget: Pick<BudgetStatusResponse, 'limitCents' | 'spentCents' | 'plannedCents'>
): BudgetBar {
  const limit = Math.max(budget.limitCents, 1);
  const ratio = budget.spentCents / limit;
  const spentWidth = Math.min(100, ratio * 100);
  const plannedWidth = Math.max(0, Math.min(100 - spentWidth, (budget.plannedCents / limit) * 100));
  return {
    spentWidth,
    plannedWidth,
    level: ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok',
    remainingCents: budget.limitCents - budget.spentCents,
  };
}

export const BUDGET_LEVEL_COLORS = {
  ok: 'var(--green)',
  warn: 'var(--orange)',
  over: 'var(--red)',
} as const;

// ------------------------------------------------------------------ repetição

export type Repetition = 'none' | 'installments' | 'weekly' | 'monthly' | 'yearly';

export const REPETITION_OPTIONS: { value: Repetition; label: string }[] = [
  { value: 'none', label: 'Não repete' },
  { value: 'installments', label: 'Parcelado' },
  { value: 'weekly', label: 'Toda semana' },
  { value: 'monthly', label: 'Todo mês' },
  { value: 'yearly', label: 'Todo ano' },
];

export const REPETITION_FREQ = {
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
} as const;

/** Campos de repetição do corpo de criação (nunca recorrência e parcelas juntas). */
export function repetitionFields(
  repetition: Repetition,
  installments: number
): { recurrence?: { rrule: string }; installments?: number } {
  if (repetition === 'none') return {};
  if (repetition === 'installments') {
    return { installments: Math.min(72, Math.max(2, Math.round(installments))) };
  }
  return { recurrence: { rrule: buildRRule({ freq: REPETITION_FREQ[repetition] }) } };
}

/** "Fatura de outubro" (com o ano quando não é o atual). */
export function invoiceTitle(referenceMonth: string, monthName: string, today: string) {
  const year = referenceMonth.slice(0, 4);
  return `Fatura de ${monthName}${year === today.slice(0, 4) ? '' : ` de ${year}`}`;
}

// ------------------------------------------------------------------ faturas

/**
 * Faturas do cartão como na Wallet: as que faltam pagar da mais próxima para a mais distante (as
 * parcelas futuras ficam no fim) e as pagas da mais recente para a mais antiga.
 */
export function groupInvoices(invoices: InvoiceResponse[]) {
  const unpaid = invoices
    .filter((i) => i.status !== 'PAID')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const paid = invoices
    .filter((i) => i.status === 'PAID')
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  return [
    { title: 'A pagar', items: unpaid },
    { title: 'Pagas', items: paid },
  ].filter((group) => group.items.length > 0);
}
