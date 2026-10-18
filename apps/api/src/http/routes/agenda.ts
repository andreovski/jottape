import type { AgendaResponse, InvoiceDue } from '@jottape/schemas';
import {
  createEventBodySchema,
  deleteEventQuerySchema,
  rangeQuerySchema,
  updateEventBodySchema,
} from '@jottape/schemas';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { fromDbDate, todayIn, toDbDate } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import {
  createEvent,
  deleteEvent,
  getEvent,
  listOccurrences,
  updateEvent,
} from '@/services/events';
import { invoiceTotal, userTimezone } from '@/services/finance';
import { toTransaction } from '@/services/serializers';
import { listTasks } from '@/services/tasks';

import { authenticate } from '../session';

const idParams = z.object({ id: z.string().uuid() });

export async function agendaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/events', async (request) => {
    const { from, to } = rangeQuerySchema.parse(request.query);
    return listOccurrences(request.userId, new Date(from), new Date(to));
  });

  app.get('/events/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return getEvent(request.userId, id);
  });

  app.post('/events', async (request, reply) => {
    const body = createEventBodySchema.parse(request.body);
    return reply.status(201).send(await createEvent(request.userId, body));
  });

  app.patch('/events/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return updateEvent(request.userId, id, updateEventBodySchema.parse(request.body));
  });

  app.delete('/events/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await deleteEvent(request.userId, id, deleteEventQuerySchema.parse(request.query));
    return reply.status(204).send();
  });

  /** Tudo do intervalo num pedido só: compromissos, tarefas com prazo, contas e faturas a vencer. */
  app.get('/agenda', async (request): Promise<AgendaResponse> => {
    const { from, to } = rangeQuerySchema.parse(request.query);
    const userId = request.userId;
    const timeZone = await userTimezone(userId);
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const firstDay = todayIn(timeZone, fromDate);
    const lastDay = todayIn(timeZone, new Date(toDate.getTime() - 1));
    const today = todayIn(timeZone);
    const includesToday = firstDay <= today && today <= lastDay;

    const [events, openTasks, bills, invoices] = await Promise.all([
      listOccurrences(userId, fromDate, toDate),
      listTasks(userId, {}),
      prisma.transaction.findMany({
        where: {
          userId,
          status: 'PLANNED',
          kind: { in: ['INCOME', 'EXPENSE'] },
          // Previstos atrasados aparecem no dia de hoje.
          date: { gte: includesToday ? undefined : toDbDate(firstDay), lte: toDbDate(lastDay) },
          invoiceId: null,
        },
        include: { recurrence: { select: { rrule: true } } },
        orderBy: { date: 'asc' },
      }),
      prisma.creditCardInvoice.findMany({
        where: {
          userId,
          paidAt: null,
          dueDate: { gte: includesToday ? undefined : toDbDate(firstDay), lte: toDbDate(lastDay) },
        },
        include: { items: { select: { kind: true, amountCents: true } }, account: true },
      }),
    ]);

    const tasks = openTasks.filter((task) => {
      if (!task.dueAt) return false;
      const due = new Date(task.dueAt);
      if (due >= fromDate && due < toDate) return true;
      return includesToday && due < fromDate;
    });

    const invoiceDues: InvoiceDue[] = invoices
      .map((invoice) => ({
        invoiceId: invoice.id,
        accountId: invoice.accountId,
        accountName: invoice.account.name,
        dueDate: fromDbDate(invoice.dueDate),
        totalCents: invoiceTotal(invoice.items),
      }))
      .filter((invoice) => invoice.totalCents > 0);

    return { events, tasks, bills: bills.map(toTransaction), invoices: invoiceDues };
  });
}
