import {
  addMonthsToMonth,
  budgetLevel,
  type LedgerTransaction,
  monthRange,
  projectBalances,
} from '@jottape/finance-engine';
import type {
  BudgetStatusResponse,
  ForecastResponse,
  MonthSummaryResponse,
} from '@jottape/schemas';
import type { Transaction } from '@prisma/client';

import { fromDbDate, todayIn, toDbDate } from '@/lib/dates';
import { prisma } from '@/lib/prisma';

import { invoiceTotal, toLedgerAccount, toLedgerTx, userTimezone } from './finance';

async function monthTransactions(userId: string, month: string) {
  const { first, last } = monthRange(month);
  return prisma.transaction.findMany({
    where: {
      userId,
      kind: { in: ['INCOME', 'EXPENSE'] },
      date: { gte: toDbDate(first), lte: toDbDate(last) },
    },
  });
}

function totalsByCategory(transactions: Transaction[], kind: 'INCOME' | 'EXPENSE') {
  const totals = new Map<string | null, number>();
  for (const tx of transactions) {
    if (tx.kind !== kind || tx.status !== 'DONE') continue;
    totals.set(tx.categoryId, (totals.get(tx.categoryId) ?? 0) + tx.amountCents);
  }
  return [...totals.entries()]
    .map(([categoryId, totalCents]) => ({ categoryId, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

const sum = (transactions: Transaction[], kind: 'INCOME' | 'EXPENSE', status: 'DONE' | 'PLANNED') =>
  transactions
    .filter((tx) => tx.kind === kind && tx.status === status)
    .reduce((total, tx) => total + tx.amountCents, 0);

export async function monthSummary(userId: string, month: string): Promise<MonthSummaryResponse> {
  const previousMonth = addMonthsToMonth(month, -1);
  const [current, previous] = await Promise.all([
    monthTransactions(userId, month),
    monthTransactions(userId, previousMonth),
  ]);
  const incomeCents = sum(current, 'INCOME', 'DONE');
  const expenseCents = sum(current, 'EXPENSE', 'DONE');

  return {
    month,
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    plannedIncomeCents: sum(current, 'INCOME', 'PLANNED'),
    plannedExpenseCents: sum(current, 'EXPENSE', 'PLANNED'),
    expenseByCategory: totalsByCategory(current, 'EXPENSE'),
    incomeByCategory: totalsByCategory(current, 'INCOME'),
    previous: {
      month: previousMonth,
      incomeCents: sum(previous, 'INCOME', 'DONE'),
      expenseCents: sum(previous, 'EXPENSE', 'DONE'),
      expenseByCategory: totalsByCategory(previous, 'EXPENSE'),
    },
  };
}

/**
 * Saldo dia a dia. Além dos previstos, cada fatura de cartão não paga entra como uma
 * transferência prevista da conta de pagamento para o cartão no vencimento.
 */
export async function forecast(userId: string, days: number): Promise<ForecastResponse> {
  const timezone = await userTimezone(userId);
  const start = todayIn(timezone);
  const [accounts, transactions, invoices] = await Promise.all([
    prisma.account.findMany({ where: { userId, archivedAt: null } }),
    prisma.transaction.findMany({ where: { userId } }),
    prisma.creditCardInvoice.findMany({
      where: { userId, paidAt: null },
      include: { items: { select: { kind: true, amountCents: true } }, account: true },
    }),
  ]);

  const accountIds = new Set(accounts.map((a) => a.id));
  const ledger: LedgerTransaction[] = transactions.map(toLedgerTx);

  for (const invoice of invoices) {
    const total = invoiceTotal(invoice.items);
    const payer = invoice.account.paymentAccountId;
    if (total <= 0 || !payer || !accountIds.has(payer)) continue;
    ledger.push({
      kind: 'TRANSFER',
      amountCents: total,
      date: fromDbDate(invoice.dueDate),
      accountId: payer,
      toAccountId: invoice.accountId,
      status: 'PLANNED',
    });
  }

  const result = projectBalances(accounts.map(toLedgerAccount), ledger, start, days);
  return { start, days: result.days, firstNegative: result.firstNegative };
}

// ---------------------------------------------------------------- orçamentos

export async function budgetStatuses(
  userId: string,
  month: string
): Promise<BudgetStatusResponse[]> {
  const [budgets, categories, transactions] = await Promise.all([
    prisma.budget.findMany({ where: { userId, month: toDbDate(`${month}-01`) } }),
    prisma.category.findMany({ where: { userId }, select: { id: true, parentId: true } }),
    monthTransactions(userId, month),
  ]);

  // Orçamento de uma categoria-mãe cobre as subcategorias.
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  const covers = (budgetCategoryId: string, categoryId: string | null) =>
    categoryId === budgetCategoryId ||
    (categoryId !== null && parentOf.get(categoryId) === budgetCategoryId);

  return budgets.map((budget) => {
    const matching = transactions.filter(
      (tx) => tx.kind === 'EXPENSE' && covers(budget.categoryId, tx.categoryId)
    );
    const spentCents = matching
      .filter((tx) => tx.status === 'DONE')
      .reduce((total, tx) => total + tx.amountCents, 0);
    const plannedCents = matching
      .filter((tx) => tx.status === 'PLANNED')
      .reduce((total, tx) => total + tx.amountCents, 0);

    return {
      id: budget.id,
      categoryId: budget.categoryId,
      month,
      limitCents: budget.limitCents,
      spentCents,
      plannedCents,
      ratio: budget.limitCents > 0 ? spentCents / budget.limitCents : 0,
      level: budgetLevel(spentCents, budget.limitCents),
    };
  });
}

export async function currentMonth(userId: string) {
  return todayIn(await userTimezone(userId)).slice(0, 7);
}
