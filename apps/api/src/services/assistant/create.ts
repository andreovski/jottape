import {
  addDays,
  parseDateString,
  startOfDayInZone,
  wallTimeToInstant,
} from '@jottape/finance-engine';
import type {
  AssistantDraft,
  AssistantMissing,
  CreateEventBody,
  CreateTaskBody,
  CreateTransactionBody,
  EventResponse,
  SaveAssistantCardBody,
  TaskResponse,
} from '@jottape/schemas';

import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { deleteEvent, createEvent, getEvent } from '@/services/events';
import { createTransactions } from '@/services/finance';
import { createTask, deleteTask, getTask } from '@/services/tasks';

// Do rascunho ao que existe de verdade (lançamentos, evento ou tarefa), e de volta no Desfazer.
// Tudo passa pelos serviços de cada tela, então o Google e os lembretes seguem as mesmas regras.

export interface Created {
  transactionIds: string[];
  eventId: string | null;
  taskId: string | null;
}

export const NOTHING: Created = { transactionIds: [], eventId: null, taskId: null };

const instant = (date: string, time: string, timeZone: string) =>
  wallTimeToInstant(
    { ...parseDateString(date), hour: Number(time.slice(0, 2)), minute: Number(time.slice(3)) },
    timeZone
  ).toISOString();

/** O que ainda falta para o rascunho virar algo. */
export function missingOf(draft: AssistantDraft): AssistantMissing[] {
  const missing: AssistantMissing[] = [];
  if (draft.type === 'transaction') {
    if (!draft.amountCents) missing.push('amount');
    if (!draft.accountId) missing.push('account');
    if (draft.kind === 'TRANSFER' && !draft.toAccountId) missing.push('toAccount');
  } else if (draft.type === 'event' && !draft.allDay && !draft.startTime) {
    missing.push('time');
  }
  return missing;
}

function transactionBody(draft: AssistantDraft): CreateTransactionBody | null {
  if (draft.type !== 'transaction' || missingOf(draft).length > 0) return null;
  return {
    kind: draft.kind,
    amountCents: draft.amountCents!,
    date: draft.date,
    accountId: draft.accountId!,
    toAccountId: draft.kind === 'TRANSFER' ? draft.toAccountId : null,
    categoryId: draft.kind === 'TRANSFER' ? null : draft.categoryId,
    description: draft.description,
    ...(draft.installments ? { installments: draft.installments } : {}),
  };
}

async function eventBody(
  userId: string,
  draft: AssistantDraft,
  timeZone: string
): Promise<CreateEventBody | null> {
  if (draft.type !== 'event' || missingOf(draft).length > 0) return null;
  // Mesmo calendário da tela Agenda: o padrão do usuário, ou só no Jottape.
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { defaultCalendarId: true },
  });
  const times = draft.allDay
    ? { startAt: `${draft.date}T00:00:00.000Z`, endAt: `${addDays(draft.date, 1)}T00:00:00.000Z` }
    : {
        startAt: instant(draft.date, draft.startTime!, timeZone),
        endAt: instant(draft.date, draft.endTime ?? draft.startTime!, timeZone),
      };
  return {
    title: draft.title,
    location: draft.location,
    allDay: draft.allDay,
    ...times,
    calendarId: user.defaultCalendarId,
  };
}

function taskBody(draft: AssistantDraft, timeZone: string): CreateTaskBody | null {
  if (draft.type !== 'task') return null;
  const dueAt = !draft.date
    ? null
    : draft.time
      ? instant(draft.date, draft.time, timeZone)
      : startOfDayInZone(draft.date, timeZone).toISOString();
  return {
    title: draft.title,
    ...(draft.listId ? { listId: draft.listId } : {}),
    dueAt,
    hasTime: Boolean(dueAt && draft.time),
  };
}

/**
 * Cria o que o rascunho descreve. A folha da tela (body.transaction/event/task) vence o rascunho.
 * Rascunho incompleto: null.
 */
export async function createFromDraft(
  userId: string,
  draft: AssistantDraft,
  timeZone: string,
  sheet: Pick<SaveAssistantCardBody, 'transaction' | 'event' | 'task'> = {}
): Promise<Created | null> {
  if (draft.type === 'transaction') {
    const body = sheet.transaction ?? transactionBody(draft);
    if (!body) return null;
    const created = await createTransactions(userId, body);
    return { ...NOTHING, transactionIds: created.map((t) => t.id) };
  }
  if (draft.type === 'event') {
    const body = sheet.event ?? (await eventBody(userId, draft, timeZone));
    if (!body) return null;
    return { ...NOTHING, eventId: (await createEvent(userId, body)).id };
  }
  const body = sheet.task ?? taskBody(draft, timeZone);
  if (!body) return null;
  return { ...NOTHING, taskId: (await createTask(userId, body)).id };
}

const ignoreMissing = (error: unknown) => {
  if (error instanceof AppError && error.statusCode === 404) return;
  throw error;
};

/** Desfaz: apaga os lançamentos (todas as parcelas), o evento ou a tarefa, se ainda existirem. */
export async function removeCreated(userId: string, created: Created) {
  if (created.transactionIds.length > 0) {
    await prisma.transaction.deleteMany({ where: { userId, id: { in: created.transactionIds } } });
  }
  if (created.eventId)
    await deleteEvent(userId, created.eventId, { scope: 'all' }).catch(ignoreMissing);
  if (created.taskId) await deleteTask(userId, created.taskId).catch(ignoreMissing);
}

/** O evento e a tarefa criados, para o cartão (null se foram apagados por fora). */
export async function loadCreated(
  userId: string,
  created: Pick<Created, 'eventId' | 'taskId'>
): Promise<{ event: EventResponse | null; task: TaskResponse | null }> {
  const [event, task] = await Promise.all([
    created.eventId ? getEvent(userId, created.eventId).catch(() => null) : null,
    created.taskId ? getTask(userId, created.taskId).catch(() => null) : null,
  ]);
  return { event, task };
}
