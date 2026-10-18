import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { fromDbDate, todayIn } from '@/lib/dates';
import { prisma } from '@/lib/prisma';

import { authenticate } from '../session';

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Os dados são do André: exporta tudo em JSON, ou os lançamentos em CSV (abre no Excel/Sheets). */
export async function exportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/export', async (request, reply) => {
    const { format } = z
      .object({ format: z.enum(['json', 'csv']).default('json') })
      .parse(request.query);
    const userId = request.userId;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const stamp = todayIn(user.timezone);

    if (format === 'csv') {
      const [transactions, accounts, categories] = await Promise.all([
        prisma.transaction.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
        prisma.account.findMany({ where: { userId } }),
        prisma.category.findMany({ where: { userId } }),
      ]);
      const accountName = new Map(accounts.map((a) => [a.id, a.name]));
      const categoryName = new Map(categories.map((c) => [c.id, c.name]));
      const KIND = { INCOME: 'Receita', EXPENSE: 'Despesa', TRANSFER: 'Transferência' } as const;
      const header = [
        'Data',
        'Descrição',
        'Tipo',
        'Valor',
        'Conta',
        'Conta destino',
        'Categoria',
        'Situação',
        'Parcela',
        'Observações',
      ];
      const rows = transactions.map((tx) => [
        fromDbDate(tx.date),
        tx.description,
        KIND[tx.kind],
        (tx.amountCents / 100).toFixed(2).replace('.', ','),
        accountName.get(tx.accountId),
        tx.toAccountId ? accountName.get(tx.toAccountId) : '',
        tx.categoryId ? categoryName.get(tx.categoryId) : '',
        tx.status === 'DONE' ? 'Efetivado' : 'Previsto',
        tx.installmentNumber ? `${tx.installmentNumber}/${tx.installmentTotal}` : '',
        tx.notes,
      ]);
      // Ponto e vírgula e BOM: o Excel em português abre direto.
      const csv = '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="jottape-lancamentos-${stamp}.csv"`)
        .send(csv);
    }

    const where = { userId };
    const [
      accounts,
      categories,
      transactions,
      recurrences,
      invoices,
      budgets,
      events,
      taskLists,
      tasks,
      tags,
    ] = await Promise.all([
      prisma.account.findMany({ where }),
      prisma.category.findMany({ where }),
      prisma.transaction.findMany({ where }),
      prisma.recurrence.findMany({ where }),
      prisma.creditCardInvoice.findMany({ where }),
      prisma.budget.findMany({ where }),
      prisma.event.findMany({ where: { userId, source: 'LOCAL' } }),
      prisma.taskList.findMany({ where }),
      prisma.task.findMany({
        where: { userId, deletedAt: null },
        include: { tags: { include: { tag: true } } },
      }),
      prisma.tag.findMany({ where }),
    ]);

    return reply
      .header('content-disposition', `attachment; filename="jottape-${stamp}.json"`)
      .send({
        exportedAt: new Date().toISOString(),
        profile: { name: user.name, email: user.email, timezone: user.timezone },
        accounts,
        categories,
        transactions,
        recurrences,
        invoices,
        budgets,
        events,
        taskLists,
        tasks,
        tags,
      });
  });
}
