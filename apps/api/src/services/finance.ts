import {
  accountBalance,
  addDays,
  addMonthsClamped,
  dateOccurrences,
  diffInDays,
  installmentDates,
  invoiceCycleFor,
  invoiceCycleForMonth,
  type LedgerAccount,
  type LedgerTransaction,
  referenceMonthForDue,
  splitInstallments,
} from '@jottape/finance-engine';
import type {
  AccountResponse,
  CreateTransactionBody,
  InvoiceResponse,
  InvoiceStatus,
  RecurrenceScope,
  UpdateTransactionBody,
} from '@jottape/schemas';
import type { Account, CreditCardInvoice, Prisma, Transaction } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { fromDbDate, todayIn, toDbDate } from '@/lib/dates';
import { AppError, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

/** Até onde os previstos de uma recorrência existem como lançamentos: 12 meses à frente. */
export const RECURRENCE_HORIZON_MONTHS = 12;

type Db = Prisma.TransactionClient | typeof prisma;

interface TransactionTemplate {
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  amountCents: number;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  description: string;
  notes: string | null;
}

export async function userTimezone(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true },
  });
  return user.timezone;
}

// ---------------------------------------------------------------- donos

async function ownedAccount(db: Db, userId: string, id: string): Promise<Account> {
  const account = await db.account.findFirst({ where: { id, userId } });
  if (!account) throw notFound('Conta');
  return account;
}

async function assertCategory(db: Db, userId: string, id: string | null | undefined) {
  if (!id) return;
  if (!(await db.category.findFirst({ where: { id, userId }, select: { id: true } }))) {
    throw notFound('Categoria');
  }
}

// ---------------------------------------------------------------- faturas

async function ensureInvoice(db: Db, userId: string, card: Account, date: string) {
  if (!card.closingDay || !card.dueDay) {
    throw new AppError(400, 'Cartão sem dia de fechamento ou de vencimento.');
  }
  const cycle = invoiceCycleFor(date, card.closingDay, card.dueDay);
  const referenceMonth = toDbDate(`${cycle.referenceMonth}-01`);
  return db.creditCardInvoice.upsert({
    where: { accountId_referenceMonth: { accountId: card.id, referenceMonth } },
    update: {},
    create: {
      userId,
      accountId: card.id,
      referenceMonth,
      closingDate: toDbDate(cycle.closingDate),
      dueDate: toDbDate(cycle.dueDate),
    },
  });
}

/** Fatura de um vencimento dado pelo banco, com as datas do banco (fechamento, se veio). */
export interface BankBill {
  dueDate: string;
  closingDate: string | null;
}

/** O mês de fechamento (1º dia) da fatura que o banco diz que vence em `bill.dueDate`. */
export function billReferenceMonth(card: Account, bill: BankBill): Date {
  if (!card.closingDay || !card.dueDay) {
    throw new AppError(400, 'Cartão sem dia de fechamento ou de vencimento.');
  }
  const month = bill.closingDate
    ? bill.closingDate.slice(0, 7)
    : referenceMonthForDue(bill.dueDate, card.closingDay, card.dueDay);
  return toDbDate(`${month}-01`);
}

/**
 * A fatura do cartão que vence em `bill.dueDate`. Quando o banco deu o fechamento, as datas dele
 * valem mais que as do cartão (e a situação da fatura segue o banco).
 */
/**
 * A fatura do cartão que já existe para o vencimento do banco (até uma semana de diferença, o mais
 * perto). Pelo vencimento, e não pelo mês do fechamento: com o fechamento na virada do mês (dia 30
 * no banco, dia 1 no cartão) o mês muda, mas a fatura é a mesma.
 */
export async function findBillInvoice(db: Db, card: Pick<Account, 'id'>, dueDate: string) {
  const near = await db.creditCardInvoice.findMany({
    where: {
      accountId: card.id,
      dueDate: { gte: toDbDate(addDays(dueDate, -7)), lte: toDbDate(addDays(dueDate, 7)) },
    },
    include: { payment: true },
  });
  const distance = (d: Date) => Math.abs(diffInDays(fromDbDate(d), dueDate));
  return near.sort((a, b) => distance(a.dueDate) - distance(b.dueDate))[0] ?? null;
}

export async function ensureBillInvoice(db: Db, userId: string, card: Account, bill: BankBill) {
  const bankDates = bill.closingDate
    ? { closingDate: toDbDate(bill.closingDate), dueDate: toDbDate(bill.dueDate) }
    : null;
  const existing = await findBillInvoice(db, card, bill.dueDate);
  if (existing) {
    return bankDates
      ? db.creditCardInvoice.update({ where: { id: existing.id }, data: bankDates })
      : existing;
  }
  const referenceMonth = billReferenceMonth(card, bill);
  const cycle = invoiceCycleForMonth(
    fromDbDate(referenceMonth).slice(0, 7),
    card.closingDay!,
    card.dueDay!
  );
  return db.creditCardInvoice.upsert({
    where: { accountId_referenceMonth: { accountId: card.id, referenceMonth } },
    update: bankDates ?? {},
    create: {
      userId,
      accountId: card.id,
      referenceMonth,
      closingDate: bankDates?.closingDate ?? toDbDate(cycle.closingDate),
      dueDate: bankDates?.dueDate ?? toDbDate(cycle.dueDate),
    },
  });
}

/** Lançamento no cartão (compra, estorno, saque) entra na fatura do ciclo; pagamento não. */
async function invoiceIdFor(
  db: Db,
  userId: string,
  account: Account,
  date: string,
  paysInvoiceId: string | null = null
): Promise<string | null> {
  if (account.type !== 'CREDIT_CARD' || paysInvoiceId) return null;
  return (await ensureInvoice(db, userId, account, date)).id;
}

/** Quanto a fatura cobra: compras e saques somam, estornos subtraem. */
export function invoiceTotal(items: Pick<Transaction, 'kind' | 'amountCents'>[]): number {
  return items.reduce(
    (sum, tx) => sum + (tx.kind === 'INCOME' ? -tx.amountCents : tx.amountCents),
    0
  );
}

export function invoiceStatus(
  invoice: Pick<CreditCardInvoice, 'closingDate' | 'dueDate' | 'paidAt'>,
  today: string
): InvoiceStatus {
  if (invoice.paidAt) return 'PAID';
  if (today < fromDbDate(invoice.closingDate)) return 'OPEN';
  if (today > fromDbDate(invoice.dueDate)) return 'OVERDUE';
  return 'CLOSED';
}

export function toInvoice(
  invoice: CreditCardInvoice & {
    items: Pick<Transaction, 'kind' | 'amountCents'>[];
    payment: Pick<Transaction, 'id'> | null;
  },
  today: string
): InvoiceResponse {
  return {
    id: invoice.id,
    accountId: invoice.accountId,
    referenceMonth: fromDbDate(invoice.referenceMonth).slice(0, 7),
    closingDate: fromDbDate(invoice.closingDate),
    dueDate: fromDbDate(invoice.dueDate),
    totalCents: invoiceTotal(invoice.items),
    status: invoiceStatus(invoice, today),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    paymentTransactionId: invoice.payment?.id ?? null,
  };
}

export async function listInvoices(userId: string, accountId: string) {
  const card = await ownedAccount(prisma, userId, accountId);
  if (card.type !== 'CREDIT_CARD') throw new AppError(400, 'A conta não é um cartão.');
  const today = todayIn(await userTimezone(userId));
  const invoices = await prisma.creditCardInvoice.findMany({
    where: { accountId },
    include: {
      items: { select: { kind: true, amountCents: true } },
      payment: { select: { id: true } },
    },
    orderBy: { referenceMonth: 'desc' },
  });
  return invoices.map((invoice) => toInvoice(invoice, today));
}

export async function payInvoice(
  userId: string,
  invoiceId: string,
  options: { fromAccountId?: string; date?: string; amountCents?: number }
) {
  const invoice = await prisma.creditCardInvoice.findFirst({
    where: { id: invoiceId, userId },
    include: { items: true, account: true, payment: true },
  });
  if (!invoice) throw notFound('Fatura');
  if (invoice.paidAt || invoice.payment) throw new AppError(409, 'Esta fatura já foi paga.');

  const total = invoiceTotal(invoice.items);
  if (total <= 0) throw new AppError(400, 'A fatura não tem valor a pagar.');

  const fromAccountId = options.fromAccountId ?? invoice.account.paymentAccountId;
  if (!fromAccountId) throw new AppError(400, 'Escolha a conta que paga a fatura.');
  const from = await ownedAccount(prisma, userId, fromAccountId);
  if (from.type === 'CREDIT_CARD')
    throw new AppError(400, 'Uma fatura não pode ser paga com cartão.');

  const timezone = await userTimezone(userId);
  const date = options.date ?? todayIn(timezone);
  const month = fromDbDate(invoice.referenceMonth);

  await prisma.$transaction([
    prisma.transaction.create({
      data: {
        userId,
        kind: 'TRANSFER',
        amountCents: options.amountCents ?? total,
        date: toDbDate(date),
        accountId: from.id,
        toAccountId: invoice.accountId,
        description: `Fatura ${invoice.account.name} ${month.slice(5, 7)}/${month.slice(0, 4)}`,
        status: 'DONE',
        paysInvoiceId: invoice.id,
      },
    }),
    prisma.creditCardInvoice.update({ where: { id: invoice.id }, data: { paidAt: new Date() } }),
  ]);

  const updated = await prisma.creditCardInvoice.findUniqueOrThrow({
    where: { id: invoice.id },
    include: {
      items: { select: { kind: true, amountCents: true } },
      payment: { select: { id: true } },
    },
  });
  return toInvoice(updated, todayIn(timezone));
}

/**
 * Um débito já lançado como despesa era, na verdade, o pagamento da fatura (o banco disse): vira a
 * transferência que paga a fatura, sem categoria, e a fatura fica paga.
 */
export async function turnIntoInvoicePayment(
  userId: string,
  invoiceId: string,
  transactionId: string
) {
  // Paga por fora (paidAt sem pagamento) também: o débito mostra de que conta saiu.
  const invoice = await prisma.creditCardInvoice.findFirst({
    where: { id: invoiceId, userId, payment: null },
  });
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, userId, kind: 'EXPENSE', invoiceId: null },
  });
  if (!invoice || !tx || tx.accountId === invoice.accountId) return false;
  await prisma.$transaction([
    prisma.transaction.update({
      where: { id: tx.id },
      data: {
        kind: 'TRANSFER',
        toAccountId: invoice.accountId,
        categoryId: null,
        paysInvoiceId: invoice.id,
        recurrenceId: null,
      },
    }),
    prisma.creditCardInvoice.update({ where: { id: invoice.id }, data: { paidAt: new Date() } }),
  ]);
  return true;
}

// ---------------------------------------------------------------- contas

export function toLedgerTx(tx: Transaction): LedgerTransaction {
  return {
    kind: tx.kind,
    amountCents: tx.amountCents,
    date: fromDbDate(tx.date),
    accountId: tx.accountId,
    toAccountId: tx.toAccountId,
    status: tx.status,
  };
}

export function toLedgerAccount(account: Account): LedgerAccount {
  return { id: account.id, type: account.type, initialBalanceCents: account.initialBalanceCents };
}

export async function listAccounts(
  userId: string,
  includeArchived = false
): Promise<AccountResponse[]> {
  const timezone = await userTimezone(userId);
  const today = todayIn(timezone);
  const [accounts, transactions] = await Promise.all([
    prisma.account.findMany({
      where: { userId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.transaction.findMany({ where: { userId } }),
  ]);
  const ledger = transactions.map(toLedgerTx);

  const cards = accounts.filter((a) => a.type === 'CREDIT_CARD');
  const openInvoices = new Map<string, number>();
  // Fatura paga por fora (conta fora do Jottape): não tem transferência, então o saldo do cartão
  // só deixa de dever essas compras somando-as de volta.
  const paidElsewhere = new Map<string, number>();
  if (cards.length > 0) {
    const elsewhere = await prisma.creditCardInvoice.findMany({
      where: { accountId: { in: cards.map((c) => c.id) }, paidAt: { not: null }, payment: null },
      include: { items: { select: { kind: true, amountCents: true } } },
    });
    for (const invoice of elsewhere) {
      paidElsewhere.set(
        invoice.accountId,
        (paidElsewhere.get(invoice.accountId) ?? 0) + invoiceTotal(invoice.items)
      );
    }
  }
  if (cards.length > 0) {
    const invoices = await prisma.creditCardInvoice.findMany({
      where: { accountId: { in: cards.map((c) => c.id) }, paidAt: null },
      include: { items: { select: { kind: true, amountCents: true } } },
      orderBy: { referenceMonth: 'asc' },
    });
    for (const invoice of invoices) {
      if (invoiceStatus(invoice, today) === 'OPEN' && !openInvoices.has(invoice.accountId)) {
        openInvoices.set(invoice.accountId, invoiceTotal(invoice.items));
      }
    }
  }

  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    initialBalanceCents: account.initialBalanceCents,
    color: account.color,
    closingDay: account.closingDay,
    dueDay: account.dueDay,
    paymentAccountId: account.paymentAccountId,
    archived: Boolean(account.archivedAt),
    balanceCents:
      accountBalance(toLedgerAccount(account), ledger) + (paidElsewhere.get(account.id) ?? 0),
    expectedBalanceCents:
      accountBalance(toLedgerAccount(account), ledger, { plannedUntil: today }) +
      (paidElsewhere.get(account.id) ?? 0),
    openInvoiceCents: account.type === 'CREDIT_CARD' ? (openInvoices.get(account.id) ?? 0) : null,
  }));
}

// ---------------------------------------------------------------- lançamentos

function defaultStatus(date: string, today: string): 'PLANNED' | 'DONE' {
  return date <= today ? 'DONE' : 'PLANNED';
}

async function validateTemplate(db: Db, userId: string, template: TransactionTemplate) {
  const account = await ownedAccount(db, userId, template.accountId);
  if (template.kind === 'TRANSFER') {
    if (!template.toAccountId) throw new AppError(400, 'Escolha a conta de destino.');
    if (template.toAccountId === template.accountId) {
      throw new AppError(400, 'Origem e destino precisam ser contas diferentes.');
    }
    await ownedAccount(db, userId, template.toAccountId);
  }
  await assertCategory(db, userId, template.categoryId);
  return account;
}

function templateFrom(body: CreateTransactionBody): TransactionTemplate {
  return {
    kind: body.kind,
    amountCents: body.amountCents,
    accountId: body.accountId,
    toAccountId: body.kind === 'TRANSFER' ? (body.toAccountId ?? null) : null,
    categoryId: body.kind === 'TRANSFER' ? null : (body.categoryId ?? null),
    description: body.description,
    notes: body.notes ?? null,
  };
}

const withRecurrence = { recurrence: { select: { rrule: true } } } as const;

/** `bill`: a fatura que o banco já disse (só para um lançamento simples no cartão). */
export async function createTransactions(
  userId: string,
  body: CreateTransactionBody,
  options: { bill?: BankBill } = {}
) {
  const today = todayIn(await userTimezone(userId));
  const template = templateFrom(body);

  return prisma.$transaction(async (db) => {
    const account = await validateTemplate(db, userId, template);
    const rows: Prisma.TransactionUncheckedCreateInput[] = [];

    if (body.installments) {
      const amounts = splitInstallments(body.amountCents, body.installments);
      const dates = installmentDates(body.date, body.installments);
      const groupId = randomUUID();
      for (let i = 0; i < amounts.length; i++) {
        // No cartão a compra parcelada já está feita: cada parcela cai numa fatura.
        const status =
          account.type === 'CREDIT_CARD'
            ? 'DONE'
            : i === 0 && body.status
              ? body.status
              : defaultStatus(dates[i], today);
        rows.push({
          ...template,
          userId,
          amountCents: amounts[i],
          date: toDbDate(dates[i]),
          status,
          installmentGroupId: groupId,
          installmentNumber: i + 1,
          installmentTotal: amounts.length,
          invoiceId: await invoiceIdFor(db, userId, account, dates[i]),
        });
      }
    } else if (body.recurrence) {
      const horizon = addMonthsClamped(
        today > body.date ? today : body.date,
        RECURRENCE_HORIZON_MONTHS
      );
      const recurrence = await db.recurrence.create({
        data: {
          userId,
          rrule: body.recurrence.rrule,
          startDate: toDbDate(body.date),
          template: template as unknown as Prisma.InputJsonValue,
          generatedUntil: toDbDate(horizon),
        },
      });
      const dates = dateOccurrences(body.recurrence.rrule, body.date, body.date, horizon);
      if (dates.length === 0) throw new AppError(400, 'A recorrência não gera nenhuma data.');
      for (const [i, date] of dates.entries()) {
        rows.push({
          ...template,
          userId,
          date: toDbDate(date),
          status: i === 0 && body.status ? body.status : defaultStatus(date, today),
          recurrenceId: recurrence.id,
          invoiceId: await invoiceIdFor(db, userId, account, date),
        });
      }
    } else {
      rows.push({
        ...template,
        userId,
        date: toDbDate(body.date),
        status: body.status ?? defaultStatus(body.date, today),
        invoiceId:
          options.bill && account.type === 'CREDIT_CARD'
            ? (await ensureBillInvoice(db, userId, account, options.bill)).id
            : await invoiceIdFor(db, userId, account, body.date),
      });
    }

    const created: Transaction[] = [];
    for (const data of rows) {
      created.push(await db.transaction.create({ data }));
    }
    return db.transaction.findMany({
      where: { id: { in: created.map((t) => t.id) } },
      include: withRecurrence,
      orderBy: { date: 'asc' },
    });
  });
}

export async function updateTransaction(userId: string, id: string, body: UpdateTransactionBody) {
  const existing = await prisma.transaction.findFirst({ where: { id, userId } });
  if (!existing) throw notFound('Lançamento');
  const { scope, ...fields } = body;

  return prisma.$transaction(async (db) => {
    const merged: TransactionTemplate = {
      kind: existing.kind,
      amountCents: fields.amountCents ?? existing.amountCents,
      accountId: fields.accountId ?? existing.accountId,
      toAccountId:
        existing.kind === 'TRANSFER'
          ? fields.toAccountId !== undefined
            ? fields.toAccountId
            : existing.toAccountId
          : null,
      categoryId:
        existing.kind === 'TRANSFER'
          ? null
          : fields.categoryId !== undefined
            ? fields.categoryId
            : existing.categoryId,
      description: fields.description ?? existing.description,
      notes: fields.notes !== undefined ? fields.notes : existing.notes,
    };
    const account = await validateTemplate(db, userId, merged);
    const date = fields.date ?? fromDbDate(existing.date);

    if (scope === 'future' && existing.recurrenceId) {
      const recurrence = await db.recurrence.findUniqueOrThrow({
        where: { id: existing.recurrenceId },
      });
      const template = { ...(recurrence.template as unknown as TransactionTemplate), ...merged };
      await db.recurrence.update({
        where: { id: recurrence.id },
        data: { template: template as unknown as Prisma.InputJsonValue },
      });

      const followers = await db.transaction.findMany({
        where: {
          recurrenceId: recurrence.id,
          date: { gt: existing.date },
          isRecurrenceException: false,
        },
      });
      for (const tx of followers) {
        const txDate = fromDbDate(tx.date);
        await db.transaction.update({
          where: { id: tx.id },
          data: { ...merged, invoiceId: await invoiceIdFor(db, userId, account, txDate) },
        });
      }
    }

    await db.transaction.update({
      where: { id },
      data: {
        ...merged,
        date: toDbDate(date),
        status: fields.status ?? existing.status,
        invoiceId: await invoiceIdFor(db, userId, account, date, existing.paysInvoiceId),
        isRecurrenceException:
          existing.recurrenceId && scope === 'single' ? true : existing.isRecurrenceException,
      },
    });

    return db.transaction.findUniqueOrThrow({ where: { id }, include: withRecurrence });
  });
}

/** Encerra a regra no dia anterior a `date`, para a extensão não recriar o que foi apagado. */
function endRuleBefore(rrule: string, date: string): string {
  const until = addDays(date, -1).replace(/-/g, '');
  const parts = rrule.split(';').filter((part) => !/^(UNTIL|COUNT)=/.test(part));
  return [...parts, `UNTIL=${until}T235959Z`].join(';');
}

export async function deleteTransaction(userId: string, id: string, scope: RecurrenceScope) {
  const existing = await prisma.transaction.findFirst({ where: { id, userId } });
  if (!existing) throw notFound('Lançamento');

  await prisma.$transaction(async (db) => {
    if (existing.paysInvoiceId) {
      await db.creditCardInvoice.update({
        where: { id: existing.paysInvoiceId },
        data: { paidAt: null },
      });
    }

    if (scope === 'future' && existing.recurrenceId) {
      const recurrence = await db.recurrence.findUniqueOrThrow({
        where: { id: existing.recurrenceId },
      });
      await db.recurrence.update({
        where: { id: recurrence.id },
        data: { rrule: endRuleBefore(recurrence.rrule, fromDbDate(existing.date)) },
      });
      await db.transaction.deleteMany({
        where: { recurrenceId: recurrence.id, date: { gte: existing.date } },
      });
      return;
    }

    await db.transaction.delete({ where: { id } });
  });
}

/**
 * Mantém cada recorrência com previstos até 12 meses à frente. Roda por dia (job) e é idempotente:
 * só gera datas depois de `generatedUntil`.
 */
export async function extendRecurrences(now = new Date()) {
  const recurrences = await prisma.recurrence.findMany({ include: { user: true } });
  let created = 0;

  for (const recurrence of recurrences) {
    const today = todayIn(recurrence.user.timezone, now);
    const horizon = addMonthsClamped(today, RECURRENCE_HORIZON_MONTHS);
    const generatedUntil = fromDbDate(recurrence.generatedUntil);
    if (generatedUntil >= horizon) continue;

    const template = recurrence.template as unknown as TransactionTemplate;
    const account = await prisma.account.findUnique({ where: { id: template.accountId } });
    if (!account) continue;

    const dates = dateOccurrences(
      recurrence.rrule,
      fromDbDate(recurrence.startDate),
      addDays(generatedUntil, 1),
      horizon
    );

    await prisma.$transaction(async (db) => {
      for (const date of dates) {
        await db.transaction.create({
          data: {
            ...template,
            userId: recurrence.userId,
            date: toDbDate(date),
            status: 'PLANNED',
            recurrenceId: recurrence.id,
            invoiceId: await invoiceIdFor(db, recurrence.userId, account, date),
          },
        });
      }
      await db.recurrence.update({
        where: { id: recurrence.id },
        data: { generatedUntil: toDbDate(horizon) },
      });
    });
    created += dates.length;
  }

  return created;
}
