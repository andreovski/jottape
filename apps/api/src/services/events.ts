import { eventOccurrences } from '@jottape/finance-engine';
import type {
  CreateEventBody,
  DeleteEventQuery,
  EventOccurrence,
  UpdateEventBody,
} from '@jottape/schemas';
import type { Event, Prisma } from '@prisma/client';

import { AppError, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

import { userTimezone } from './finance';
import { deleteEventFromGoogle, pushEventToGoogle } from './google/calendar';
import { deleteReminders, refreshReminders, remindersByOwner, setReminders } from './reminders';
import { toEvent } from './serializers';

function occurrenceOf(
  event: Event,
  start: Date,
  end: Date,
  originalStart: Date,
  master: Event | null,
  reminders: number[]
): EventOccurrence {
  return {
    eventId: master?.id ?? event.id,
    occurrenceStart: originalStart.toISOString(),
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allDay: event.allDay,
    title: event.title,
    description: event.description,
    location: event.location,
    color: event.color ?? master?.color ?? null,
    rrule: master?.rrule ?? event.rrule,
    isRecurring: Boolean(master?.rrule ?? event.rrule),
    isException: Boolean(master),
    source: event.source,
    calendarId: event.calendarId,
    reminders,
  };
}

/** Calendários do Google que entram na agenda: os marcados. Eventos locais entram sempre. */
function visibleWhere(userId: string): Prisma.EventWhereInput {
  return { userId, OR: [{ calendarId: null }, { calendar: { selected: true } }] };
}

/** Todas as ocorrências que se sobrepõem a [from, to), com recorrências expandidas. */
export async function listOccurrences(userId: string, from: Date, to: Date) {
  const timeZone = await userTimezone(userId);
  const visible = visibleWhere(userId);

  const [singles, masters] = await Promise.all([
    prisma.event.findMany({
      where: {
        ...visible,
        rrule: null,
        recurringEventId: null,
        status: 'CONFIRMED',
        startAt: { lt: to },
        endAt: { gt: from },
      },
    }),
    prisma.event.findMany({
      where: {
        ...visible,
        rrule: { not: null },
        recurringEventId: null,
        status: 'CONFIRMED',
        startAt: { lt: to },
      },
    }),
  ]);

  const overrides = masters.length
    ? await prisma.event.findMany({ where: { recurringEventId: { in: masters.map((m) => m.id) } } })
    : [];
  const reminders = await remindersByOwner('EVENT', [
    ...singles.map((e) => e.id),
    ...masters.map((e) => e.id),
  ]);

  const result: EventOccurrence[] = singles.map((event) =>
    occurrenceOf(
      event,
      event.startAt,
      event.endAt,
      event.startAt,
      null,
      reminders.get(event.id) ?? []
    )
  );

  for (const master of masters) {
    const duration = master.endAt.getTime() - master.startAt.getTime();
    const mine = overrides.filter((o) => o.recurringEventId === master.id);
    const replaced = new Set(mine.map((o) => o.originalStartAt?.getTime()));
    const masterReminders = reminders.get(master.id) ?? [];

    // Dia inteiro mora em meia-noite UTC: expande sem fuso.
    const zone = master.allDay ? 'UTC' : timeZone;
    for (const start of eventOccurrences(master.rrule!, master.startAt, from, to, zone, duration)) {
      if (replaced.has(start.getTime())) continue;
      result.push({
        ...occurrenceOf(
          master,
          start,
          new Date(start.getTime() + duration),
          start,
          null,
          masterReminders
        ),
      });
    }

    for (const override of mine) {
      if (override.status === 'CANCELLED') continue;
      if (override.startAt >= to || override.endAt <= from) continue;
      result.push(
        occurrenceOf(
          override,
          override.startAt,
          override.endAt,
          override.originalStartAt ?? override.startAt,
          master,
          masterReminders
        )
      );
    }
  }

  return result.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** Confere o calendário e diz de que provedor ele é (null = só no Jottape). */
async function assertCalendar(userId: string, calendarId: string | null | undefined) {
  if (!calendarId) return null;
  const calendar = await prisma.googleCalendar.findFirst({
    where: { id: calendarId, userId },
    include: { connection: { select: { provider: true } } },
  });
  if (!calendar) throw notFound('Calendário');
  return calendar.connection.provider;
}

async function eventResponse(event: Event) {
  const reminders = await prisma.reminder.findMany({
    where: { ownerType: 'EVENT', ownerId: event.id },
  });
  return toEvent(event, reminders);
}

/** Dia inteiro: guarda meia-noite UTC do dia (início) e do dia seguinte ao último (fim). */
function normalizeAllDay(startAt: Date, endAt: Date): { startAt: Date; endAt: Date } {
  const start = new Date(`${startAt.toISOString().slice(0, 10)}T00:00:00.000Z`);
  let end = new Date(`${endAt.toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (end <= start) end = new Date(start.getTime() + 86_400_000);
  return { startAt: start, endAt: end };
}

export async function getEvent(userId: string, id: string) {
  const event = await prisma.event.findFirst({ where: { id, userId } });
  if (!event) throw notFound('Evento');
  return eventResponse(event);
}

export async function createEvent(userId: string, body: CreateEventBody) {
  const provider = await assertCalendar(userId, body.calendarId);
  let times = { startAt: new Date(body.startAt), endAt: new Date(body.endAt) };
  if (body.allDay) times = normalizeAllDay(times.startAt, times.endAt);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const event = await prisma.event.create({
    data: {
      userId,
      title: body.title,
      description: body.description ?? null,
      location: body.location ?? null,
      ...times,
      allDay: body.allDay,
      color: body.color ?? null,
      rrule: body.rrule ?? null,
      calendarId: body.calendarId ?? null,
      source: provider ?? 'LOCAL',
      syncState: body.calendarId ? 'PENDING' : 'SYNCED',
    },
  });

  const reminders =
    body.reminders ??
    (user.defaultReminderMin !== null && !body.allDay ? [user.defaultReminderMin] : []);
  await setReminders(userId, 'EVENT', event.id, reminders);

  // Série nova num calendário da Microsoft volta como ocorrências: responde com a primeira.
  const replacedBy = event.calendarId ? await pushEventToGoogle(event.id) : undefined;
  if (replacedBy) return getEvent(userId, replacedBy);
  if (!(await prisma.event.count({ where: { id: event.id } }))) return toEvent(event, []);
  return getEvent(userId, event.id);
}

export async function updateEvent(userId: string, id: string, body: UpdateEventBody) {
  const event = await prisma.event.findFirst({ where: { id, userId } });
  if (!event) throw notFound('Evento');
  const { scope, occurrenceStart, reminders, calendarId, ...fields } = body;

  if (calendarId !== undefined && calendarId !== event.calendarId) {
    throw new AppError(400, 'Para trocar o calendário, apague e crie o evento de novo.');
  }
  if (event.source === 'MICROSOFT' && fields.rrule) {
    throw new AppError(400, 'A repetição de um evento do Outlook se muda no próprio Outlook.');
  }

  const data: Prisma.EventUncheckedUpdateInput = {
    ...(fields.title !== undefined && { title: fields.title }),
    ...(fields.description !== undefined && { description: fields.description }),
    ...(fields.location !== undefined && { location: fields.location }),
    ...(fields.color !== undefined && { color: fields.color }),
    ...(fields.allDay !== undefined && { allDay: fields.allDay }),
  };

  const allDay = fields.allDay ?? event.allDay;

  if (event.rrule && scope === 'single') {
    if (!occurrenceStart) throw new AppError(400, 'Informe a ocorrência (occurrenceStart).');
    const original = new Date(occurrenceStart);
    const duration = event.endAt.getTime() - event.startAt.getTime();
    let times = {
      startAt: fields.startAt ? new Date(fields.startAt) : original,
      endAt: fields.endAt ? new Date(fields.endAt) : new Date(original.getTime() + duration),
    };
    if (allDay) times = normalizeAllDay(times.startAt, times.endAt);

    const existing = await prisma.event.findFirst({
      where: { recurringEventId: event.id, originalStartAt: original },
    });
    const override = existing
      ? await prisma.event.update({
          where: { id: existing.id },
          data: {
            ...data,
            ...times,
            status: 'CONFIRMED',
            syncState: event.calendarId ? 'PENDING' : 'SYNCED',
          },
        })
      : await prisma.event.create({
          data: {
            userId,
            title: event.title,
            description: event.description,
            location: event.location,
            color: event.color,
            allDay: event.allDay,
            source: event.source,
            calendarId: event.calendarId,
            ...(data as Partial<Prisma.EventUncheckedCreateInput>),
            ...times,
            recurringEventId: event.id,
            originalStartAt: original,
            syncState: event.calendarId ? 'PENDING' : 'SYNCED',
          },
        });
    if (override.calendarId) await pushEventToGoogle(override.id);
    await refreshReminders('EVENT', event.id);
    return eventResponse(override);
  }

  if (fields.rrule !== undefined) data.rrule = fields.rrule;
  if (fields.startAt || fields.endAt || fields.allDay !== undefined) {
    let times = {
      startAt: fields.startAt ? new Date(fields.startAt) : event.startAt,
      endAt: fields.endAt ? new Date(fields.endAt) : event.endAt,
    };
    if (times.endAt < times.startAt) throw new AppError(400, 'O fim precisa ser depois do início.');
    if (allDay) times = normalizeAllDay(times.startAt, times.endAt);
    Object.assign(data, times);
  }
  if (event.calendarId) data.syncState = 'PENDING';

  await prisma.event.update({ where: { id }, data });
  if (reminders) await setReminders(userId, 'EVENT', id, reminders);
  else await refreshReminders('EVENT', id);

  if (event.calendarId) await pushEventToGoogle(id);
  return getEvent(userId, id);
}

export async function deleteEvent(userId: string, id: string, query: DeleteEventQuery) {
  const event = await prisma.event.findFirst({ where: { id, userId } });
  if (!event) throw notFound('Evento');

  if (event.rrule && query.scope === 'single') {
    if (!query.occurrenceStart) throw new AppError(400, 'Informe a ocorrência (occurrenceStart).');
    const original = new Date(query.occurrenceStart);
    const duration = event.endAt.getTime() - event.startAt.getTime();
    const existing = await prisma.event.findFirst({
      where: { recurringEventId: event.id, originalStartAt: original },
    });
    const cancelled = existing
      ? await prisma.event.update({
          where: { id: existing.id },
          data: { status: 'CANCELLED', syncState: event.calendarId ? 'PENDING' : 'SYNCED' },
        })
      : await prisma.event.create({
          data: {
            userId,
            title: event.title,
            allDay: event.allDay,
            startAt: original,
            endAt: new Date(original.getTime() + duration),
            status: 'CANCELLED',
            source: event.source,
            calendarId: event.calendarId,
            recurringEventId: event.id,
            originalStartAt: original,
            syncState: event.calendarId ? 'PENDING' : 'SYNCED',
          },
        });
    if (cancelled.calendarId) await pushEventToGoogle(cancelled.id);
    await refreshReminders('EVENT', event.id);
    return;
  }

  // Override apagado inteiro vira cancelamento da ocorrência.
  if (event.recurringEventId) {
    await prisma.event.update({
      where: { id },
      data: { status: 'CANCELLED', syncState: event.calendarId ? 'PENDING' : 'SYNCED' },
    });
    if (event.calendarId) await pushEventToGoogle(id);
    return;
  }

  if (event.calendarId && event.googleEventId) await deleteEventFromGoogle(event);
  await deleteReminders('EVENT', [id]);
  await prisma.event.delete({ where: { id } });
}
