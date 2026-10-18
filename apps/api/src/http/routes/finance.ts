import { addMonthsToMonth, monthRange } from '@jottape/finance-engine';
import {
  createAccountBodySchema,
  createCategoryBodySchema,
  createTransactionBodySchema,
  deleteTransactionQuerySchema,
  forecastQuerySchema,
  isoMonthSchema,
  listTransactionsQuerySchema,
  monthSummaryQuerySchema,
  payInvoiceBodySchema,
  updateAccountBodySchema,
  updateCategoryBodySchema,
  updateTransactionBodySchema,
  upsertBudgetBodySchema,
} from '@jottape/schemas';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { toDbDate } from '@/lib/dates';
import { AppError, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import {
  createTransactions,
  deleteTransaction,
  listAccounts,
  listInvoices,
  payInvoice,
  updateTransaction,
} from '@/services/finance';
import { budgetStatuses, currentMonth, forecast, monthSummary } from '@/services/reports';
import { toCategory, toTransaction } from '@/services/serializers';

import { authenticate } from '../session';

const idParams = z.object({ id: z.string().uuid() });

export async function financeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ------------------------------------------------------------ contas

  app.get('/accounts', async (request) => {
    const { archived } = z.object({ archived: z.coerce.boolean().optional() }).parse(request.query);
    return listAccounts(request.userId, archived);
  });

  app.post('/accounts', async (request, reply) => {
    const body = createAccountBodySchema.parse(request.body);
    if (body.paymentAccountId) {
      const payer = await prisma.account.findFirst({
        where: { id: body.paymentAccountId, userId: request.userId },
      });
      if (!payer) throw notFound('Conta de pagamento');
    }
    const isCard = body.type === 'CREDIT_CARD';
    const account = await prisma.account.create({
      data: {
        userId: request.userId,
        name: body.name,
        type: body.type,
        initialBalanceCents: isCard ? 0 : body.initialBalanceCents,
        color: body.color ?? null,
        closingDay: isCard ? body.closingDay : null,
        dueDay: isCard ? body.dueDay : null,
        paymentAccountId: isCard ? (body.paymentAccountId ?? null) : null,
      },
    });
    const accounts = await listAccounts(request.userId, true);
    return reply.status(201).send(accounts.find((a) => a.id === account.id));
  });

  app.patch('/accounts/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const { archived, ...body } = updateAccountBodySchema.parse(request.body);
    const account = await prisma.account.findFirst({ where: { id, userId: request.userId } });
    if (!account) throw notFound('Conta');
    if (body.paymentAccountId === id)
      throw new AppError(400, 'O cartão não pode pagar a si mesmo.');

    await prisma.account.update({
      where: { id },
      data: {
        ...body,
        ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }),
      },
    });
    const accounts = await listAccounts(request.userId, true);
    return accounts.find((a) => a.id === id);
  });

  app.delete('/accounts/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const account = await prisma.account.findFirst({ where: { id, userId: request.userId } });
    if (!account) throw notFound('Conta');
    const used = await prisma.transaction.count({
      where: { OR: [{ accountId: id }, { toAccountId: id }] },
    });
    if (used > 0) {
      throw new AppError(409, 'A conta tem lançamentos. Arquive em vez de apagar.');
    }
    await prisma.account.delete({ where: { id } });
    return reply.status(204).send();
  });

  app.get('/accounts/:id/invoices', async (request) => {
    const { id } = idParams.parse(request.params);
    return listInvoices(request.userId, id);
  });

  app.get('/invoices/:id/transactions', async (request) => {
    const { id } = idParams.parse(request.params);
    const invoice = await prisma.creditCardInvoice.findFirst({
      where: { id, userId: request.userId },
    });
    if (!invoice) throw notFound('Fatura');
    const items = await prisma.transaction.findMany({
      where: { invoiceId: id },
      include: { recurrence: { select: { rrule: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return items.map(toTransaction);
  });

  app.post('/invoices/:id/pay', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = payInvoiceBodySchema.parse(request.body ?? {});
    return payInvoice(request.userId, id, body);
  });

  // ------------------------------------------------------------ categorias

  app.get('/categories', async (request) => {
    const categories = await prisma.category.findMany({
      where: { userId: request.userId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return categories.map(toCategory);
  });

  app.post('/categories', async (request, reply) => {
    const body = createCategoryBodySchema.parse(request.body);
    if (body.parentId) {
      const parent = await prisma.category.findFirst({
        where: { id: body.parentId, userId: request.userId },
      });
      if (!parent) throw notFound('Categoria-mãe');
      if (parent.parentId) throw new AppError(400, 'Subcategorias vão até um nível só.');
      if (parent.kind !== body.kind)
        throw new AppError(400, 'A subcategoria precisa ser do mesmo tipo.');
    }
    const category = await prisma.category.create({
      data: {
        userId: request.userId,
        name: body.name,
        kind: body.kind,
        parentId: body.parentId ?? null,
        icon: body.icon ?? null,
        color: body.color ?? null,
      },
    });
    return reply.status(201).send(toCategory(category));
  });

  app.patch('/categories/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateCategoryBodySchema.parse(request.body);
    const category = await prisma.category.findFirst({ where: { id, userId: request.userId } });
    if (!category) throw notFound('Categoria');
    if (body.parentId === id) throw new AppError(400, 'A categoria não pode ser mãe de si mesma.');
    return toCategory(await prisma.category.update({ where: { id }, data: body }));
  });

  app.delete('/categories/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const category = await prisma.category.findFirst({ where: { id, userId: request.userId } });
    if (!category) throw notFound('Categoria');
    // Os lançamentos ficam sem categoria (onDelete: SetNull).
    await prisma.category.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ------------------------------------------------------------ lançamentos

  app.get('/transactions', async (request) => {
    const query = listTransactionsQuerySchema.parse(request.query);
    const where: Prisma.TransactionWhereInput = { userId: request.userId };

    const range = query.month ? monthRange(query.month) : null;
    const from = query.from ?? range?.first;
    const to = query.to ?? range?.last;
    if (from || to) {
      where.date = {
        ...(from ? { gte: toDbDate(from) } : {}),
        ...(to ? { lte: toDbDate(to) } : {}),
      };
    }
    if (query.accountId)
      where.OR = [{ accountId: query.accountId }, { toAccountId: query.accountId }];
    if (query.categoryId) {
      where.category = { OR: [{ id: query.categoryId }, { parentId: query.categoryId }] };
    }
    if (query.kind) where.kind = query.kind;
    if (query.status) where.status = query.status;
    if (query.search) where.description = { contains: query.search, mode: 'insensitive' };

    const transactions = await prisma.transaction.findMany({
      where,
      include: { recurrence: { select: { rrule: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });
    return transactions.map(toTransaction);
  });

  app.post('/transactions', async (request, reply) => {
    const body = createTransactionBodySchema.parse(request.body);
    const created = await createTransactions(request.userId, body);
    return reply.status(201).send(created.map(toTransaction));
  });

  app.patch('/transactions/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateTransactionBodySchema.parse(request.body);
    return toTransaction(await updateTransaction(request.userId, id, body));
  });

  app.delete('/transactions/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { scope } = deleteTransactionQuerySchema.parse(request.query);
    await deleteTransaction(request.userId, id, scope);
    return reply.status(204).send();
  });

  // ------------------------------------------------------------ orçamentos

  app.get('/budgets', async (request) => {
    const { month } = z.object({ month: isoMonthSchema.optional() }).parse(request.query);
    return budgetStatuses(request.userId, month ?? (await currentMonth(request.userId)));
  });

  app.put('/budgets', async (request) => {
    const body = upsertBudgetBodySchema.parse(request.body);
    const category = await prisma.category.findFirst({
      where: { id: body.categoryId, userId: request.userId },
    });
    if (!category) throw notFound('Categoria');
    if (category.kind !== 'EXPENSE') throw new AppError(400, 'Orçamento é só para despesas.');
    const month = toDbDate(`${body.month}-01`);
    await prisma.budget.upsert({
      where: { categoryId_month: { categoryId: body.categoryId, month } },
      update: { limitCents: body.limitCents },
      create: {
        userId: request.userId,
        categoryId: body.categoryId,
        month,
        limitCents: body.limitCents,
      },
    });
    const statuses = await budgetStatuses(request.userId, body.month);
    return statuses.find((s) => s.categoryId === body.categoryId);
  });

  /** Copia os orçamentos do mês anterior para `month` (sem sobrescrever os que já existem). */
  app.post('/budgets/copy-previous', async (request) => {
    const { month } = z.object({ month: isoMonthSchema }).parse(request.body);
    const previous = await prisma.budget.findMany({
      where: { userId: request.userId, month: toDbDate(`${addMonthsToMonth(month, -1)}-01`) },
    });
    await prisma.budget.createMany({
      data: previous.map((b) => ({
        userId: request.userId,
        categoryId: b.categoryId,
        month: toDbDate(`${month}-01`),
        limitCents: b.limitCents,
      })),
      skipDuplicates: true,
    });
    return budgetStatuses(request.userId, month);
  });

  app.delete('/budgets/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { count } = await prisma.budget.deleteMany({ where: { id, userId: request.userId } });
    if (count === 0) throw notFound('Orçamento');
    return reply.status(204).send();
  });

  // ------------------------------------------------------------ relatórios

  app.get('/reports/month', async (request) => {
    const { month } = monthSummaryQuerySchema.parse(request.query);
    return monthSummary(request.userId, month);
  });

  app.get('/reports/forecast', async (request) => {
    const { days } = forecastQuerySchema.parse(request.query);
    return forecast(request.userId, days);
  });
}
