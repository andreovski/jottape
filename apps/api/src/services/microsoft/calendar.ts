import { parseSimpleRRule } from '@jottape/finance-engine';
import type { Event, GoogleCalendar } from '@prisma/client';

import { getAppUrl } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { channelToken } from '@/services/google/calendar';
import { GoogleApiError } from '@/services/google/client';
import { setReminders } from '@/services/reminders';

import { graphFetch } from './client';

// Agenda da Microsoft pelo calendarView/delta: o Graph entrega cada ocorrência já expandida (sem a
// regra da série), numa janela de datas. Por isso, no Jottape, um evento da Microsoft é sempre um
// evento simples: editar ou apagar uma ocorrência de uma série mexe só nela. Série nova criada no
// Jottape vai para o Outlook com a recorrência e é trocada pelas ocorrências que voltam.

/** Janela sincronizada: de 180 dias atrás a 1 ano à frente; anda quando fica com mais de 30 dias. */
const LOOKBACK_DAYS = 180;
const LOOKAHEAD_DAYS = 365;
const WINDOW_REFRESH_DAYS = 30;
const DAY = 86_400_000;

interface GraphDate {
  dateTime: string;
  timeZone?: string;
}

export interface GraphEvent {
  id: string;
  '@removed'?: { reason: string };
  changeKey?: string;
  subject?: string;
  body?: { contentType?: string; content?: string };
  location?: { displayName?: string };
  start?: GraphDate;
  end?: GraphDate;
  isAllDay?: boolean;
  isCancelled?: boolean;
  type?: 'singleInstance' | 'occurrence' | 'exception' | 'seriesMaster';
  seriesMasterId?: string;
}

interface GraphCalendar {
  id: string;
  name: string;
  hexColor?: string;
  isDefaultCalendar?: boolean;
}

interface GraphPage<T> {
  value?: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

const enc = (value: string) => encodeURIComponent(value);

/** "2026-10-20T10:00:00.0000000" em UTC (o Prefer pede UTC) -> Date. */
function parseGraphDate(value: GraphDate | undefined, allDay: boolean): Date | null {
  if (!value?.dateTime) return null;
  if (allDay) return new Date(`${value.dateTime.slice(0, 10)}T00:00:00.000Z`);
  return new Date(`${value.dateTime.slice(0, 19)}Z`);
}

// ---------------------------------------------------------------- lista de calendários

export async function syncMicrosoftCalendarList(connectionId: string) {
  const { userId } = await prisma.googleConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });
  const items: GraphCalendar[] = [];
  let next: string | undefined = '/me/calendars?$top=100';
  while (next) {
    const page: GraphPage<GraphCalendar> = await graphFetch(connectionId, next);
    items.push(...(page.value ?? []));
    next = page['@odata.nextLink'];
  }

  for (const item of items) {
    const color = item.hexColor && /^#[0-9a-f]{6}$/i.test(item.hexColor) ? item.hexColor : null;
    await prisma.googleCalendar.upsert({
      where: { connectionId_googleCalendarId: { connectionId, googleCalendarId: item.id } },
      update: { name: item.name, color, primary: Boolean(item.isDefaultCalendar) },
      create: {
        userId,
        connectionId,
        googleCalendarId: item.id,
        name: item.name,
        color,
        primary: Boolean(item.isDefaultCalendar),
        // Como no Google: na primeira conexão só o calendário principal vem ligado.
        selected: Boolean(item.isDefaultCalendar),
      },
    });
  }
  await prisma.googleCalendar.deleteMany({
    where: { connectionId, googleCalendarId: { notIn: items.map((i) => i.id) } },
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.defaultCalendarId) {
    const primary = await prisma.googleCalendar.findFirst({
      where: { connectionId, primary: true },
    });
    if (primary) {
      await prisma.user.update({ where: { id: userId }, data: { defaultCalendarId: primary.id } });
    }
  }
}

// ---------------------------------------------------------------- Microsoft -> Jottape

async function applyRemoteEvent(calendar: GoogleCalendar, item: GraphEvent) {
  const existing = await prisma.event.findUnique({
    where: { calendarId_googleEventId: { calendarId: calendar.id, googleEventId: item.id } },
  });
  // Edição local ainda não enviada vence, como no Google.
  if (existing?.syncState === 'PENDING') return;

  if (item['@removed'] || item.isCancelled || item.type === 'seriesMaster') {
    if (existing) await prisma.event.delete({ where: { id: existing.id } });
    return;
  }

  const allDay = Boolean(item.isAllDay);
  const start = parseGraphDate(item.start, allDay);
  if (!start) return;
  const end = parseGraphDate(item.end, allDay);
  const data = {
    title: item.subject || '(sem título)',
    description: item.body?.content?.trim() || null,
    location: item.location?.displayName || null,
    startAt: start,
    endAt: end && end > start ? end : new Date(start.getTime() + (allDay ? DAY : 3_600_000)),
    allDay,
    rrule: null,
    status: 'CONFIRMED' as const,
    etag: item.changeKey ?? null,
    syncState: 'SYNCED' as const,
  };

  if (existing) {
    await prisma.event.update({ where: { id: existing.id }, data });
  } else {
    await prisma.event.create({
      data: {
        ...data,
        userId: calendar.userId,
        source: 'MICROSOFT',
        calendarId: calendar.id,
        googleEventId: item.id,
      },
    });
  }
}

function isSyncStateGone(error: unknown) {
  return (
    error instanceof GoogleApiError &&
    (error.status === 410 ||
      error.body.includes('SyncStateNotFound') ||
      error.body.includes('resyncRequired'))
  );
}

/** Sincroniza um calendário pelo delta. Devolve o que veio, para quem precisar (série nova). */
export async function syncMicrosoftCalendar(calendarId: string): Promise<GraphEvent[]> {
  let calendar = await prisma.googleCalendar.findUnique({ where: { id: calendarId } });
  if (!calendar) return [];

  // Janela velha: recomeça do zero com uma janela nova (os eventos sincronizados voltam).
  const windowAge = calendar.syncWindowStart
    ? Date.now() - (calendar.syncWindowStart.getTime() + LOOKBACK_DAYS * DAY)
    : Infinity;
  if (!calendar.syncToken || windowAge > WINDOW_REFRESH_DAYS * DAY) {
    await prisma.event.deleteMany({ where: { calendarId, syncState: 'SYNCED' } });
    const windowStart = new Date(Date.now() - LOOKBACK_DAYS * DAY);
    calendar = await prisma.googleCalendar.update({
      where: { id: calendarId },
      data: { syncToken: null, syncWindowStart: windowStart },
    });
  }

  const items: GraphEvent[] = [];
  let next: string | undefined =
    calendar.syncToken ??
    `/me/calendars/${enc(calendar.googleCalendarId)}/calendarView/delta?startDateTime=${calendar.syncWindowStart!.toISOString()}&endDateTime=${new Date(calendar.syncWindowStart!.getTime() + (LOOKBACK_DAYS + LOOKAHEAD_DAYS) * DAY).toISOString()}`;
  let deltaLink: string | undefined;
  try {
    while (next) {
      const page: GraphPage<GraphEvent> = await graphFetch(calendar.connectionId, next, {
        headers: {
          prefer: 'outlook.timezone="UTC", outlook.body-content-type="text", odata.maxpagesize=100',
        },
      });
      items.push(...(page.value ?? []));
      next = page['@odata.nextLink'];
      deltaLink = page['@odata.deltaLink'] ?? deltaLink;
    }
  } catch (error) {
    if (isSyncStateGone(error) && calendar.syncToken) {
      await prisma.googleCalendar.update({ where: { id: calendarId }, data: { syncToken: null } });
      return syncMicrosoftCalendar(calendarId);
    }
    throw error;
  }

  for (const item of items) await applyRemoteEvent(calendar, item);
  await prisma.googleCalendar.update({
    where: { id: calendarId },
    data: { syncToken: deltaLink ?? calendar.syncToken, syncedAt: new Date() },
  });
  return items;
}

// ---------------------------------------------------------------- Jottape -> Microsoft

function wallTime(instant: Date, timeZone: string) {
  // "2026-10-20 07:00:00" no fuso -> "2026-10-20T07:00:00"
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .format(instant)
    .replace(' ', 'T');
}

const GRAPH_WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** RRULE simples do Jottape -> patternedRecurrence do Graph (null se não der para traduzir). */
export function graphRecurrence(rrule: string, event: Event, timeZone: string) {
  const rule = parseSimpleRRule(rrule);
  if (!rule) return null;
  const startDate = event.allDay
    ? event.startAt.toISOString().slice(0, 10)
    : wallTime(event.startAt, timeZone).slice(0, 10);
  const [, month, day] = startDate.split('-').map(Number);
  const weekday = new Date(`${startDate}T12:00:00Z`).getUTCDay();
  const interval = rule.interval ?? 1;

  const pattern =
    rule.freq === 'DAILY'
      ? { type: 'daily', interval }
      : rule.freq === 'WEEKLY'
        ? {
            type: 'weekly',
            interval,
            daysOfWeek: (rule.byWeekday?.length ? rule.byWeekday : [weekday]).map(
              (d) => GRAPH_WEEKDAYS[d]
            ),
            firstDayOfWeek: 'sunday',
          }
        : rule.freq === 'MONTHLY'
          ? { type: 'absoluteMonthly', interval, dayOfMonth: day }
          : { type: 'absoluteYearly', interval, dayOfMonth: day, month };

  const range = rule.count
    ? { type: 'numbered', startDate, numberOfOccurrences: rule.count }
    : rule.until
      ? { type: 'endDate', startDate, endDate: rule.until }
      : { type: 'noEnd', startDate };
  return { pattern, range: { ...range, recurrenceTimeZone: timeZone } };
}

function graphTimes(event: Event, timeZone: string) {
  if (event.allDay) {
    return {
      isAllDay: true,
      start: { dateTime: `${event.startAt.toISOString().slice(0, 10)}T00:00:00`, timeZone: 'UTC' },
      end: { dateTime: `${event.endAt.toISOString().slice(0, 10)}T00:00:00`, timeZone: 'UTC' },
    };
  }
  // No fuso do usuário: a série fica presa à hora local (horário de verão incluído).
  return {
    isAllDay: false,
    start: { dateTime: wallTime(event.startAt, timeZone), timeZone },
    end: { dateTime: wallTime(event.endAt, timeZone), timeZone },
  };
}

/**
 * Envia o evento. Uma série nova vira série no Outlook e o mestre local dá lugar às ocorrências
 * que voltam do delta (com os mesmos alertas); nesse caso devolve o id da primeira delas.
 */
export async function pushEventToMicrosoft(eventId: string): Promise<string | undefined> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { calendar: true, user: true },
  });
  if (!event?.calendar) return;
  const { calendar } = event;
  const timeZone = event.user.timezone;

  // Exceção de série local: com a Microsoft não acontece (a série volta como ocorrências soltas).
  if (event.recurringEventId) {
    await prisma.event.update({ where: { id: event.id }, data: { syncState: 'ERROR' } });
    return;
  }

  const body = {
    subject: event.title,
    body: { contentType: 'text', content: event.description ?? '' },
    location: { displayName: event.location ?? '' },
    ...graphTimes(event, timeZone),
  };

  if (event.rrule && !event.googleEventId) {
    const recurrence = graphRecurrence(event.rrule, event, timeZone);
    const created = await graphFetch<GraphEvent>(
      calendar.connectionId,
      `/me/calendars/${enc(calendar.googleCalendarId)}/events`,
      { method: 'POST', body: { ...body, recurrence } }
    );
    const reminders = await prisma.reminder.findMany({
      where: { ownerType: 'EVENT', ownerId: event.id },
    });
    const minutes = [...new Set(reminders.map((r) => r.minutesBefore))];
    await prisma.reminder.deleteMany({ where: { ownerType: 'EVENT', ownerId: event.id } });
    await prisma.event.delete({ where: { id: event.id } });

    const items = await syncMicrosoftCalendar(calendar.id);
    const instances = await prisma.event.findMany({
      where: {
        calendarId: calendar.id,
        googleEventId: {
          in: items.filter((i) => i.seriesMasterId === created.id).map((i) => i.id),
        },
      },
      orderBy: { startAt: 'asc' },
    });
    if (minutes.length) {
      for (const instance of instances) {
        await setReminders(event.userId, 'EVENT', instance.id, minutes);
      }
    }
    return instances[0]?.id;
  }

  const result = event.googleEventId
    ? await graphFetch<GraphEvent>(
        calendar.connectionId,
        `/me/events/${enc(event.googleEventId)}`,
        {
          method: 'PATCH',
          body,
        }
      )
    : await graphFetch<GraphEvent>(
        calendar.connectionId,
        `/me/calendars/${enc(calendar.googleCalendarId)}/events`,
        { method: 'POST', body }
      );
  await prisma.event.update({
    where: { id: event.id },
    data: {
      googleEventId: result?.id ?? event.googleEventId,
      etag: result?.changeKey ?? event.etag,
      syncState: 'SYNCED',
    },
  });
}

export async function deleteEventFromMicrosoft(event: Event, calendar: GoogleCalendar) {
  if (!event.googleEventId) return;
  await graphFetch(calendar.connectionId, `/me/events/${enc(event.googleEventId)}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------- webhook (subscriptions)

/** A Microsoft também só aceita webhook em HTTPS público. Assinatura dura no máximo ~3 dias. */
function webhookAddress(): string | null {
  const url = `${getAppUrl()}/api/microsoft/webhook`;
  return url.startsWith('https://') ? url : null;
}

const SUBSCRIPTION_HOURS = 60;

export async function stopMicrosoftWatch(calendar: GoogleCalendar) {
  if (!calendar.watchChannelId) return;
  await graphFetch(calendar.connectionId, `/subscriptions/${enc(calendar.watchChannelId)}`, {
    method: 'DELETE',
  }).catch(() => undefined);
  await prisma.googleCalendar.update({
    where: { id: calendar.id },
    data: { watchChannelId: null, watchResourceId: null, watchExpiresAt: null },
  });
}

export async function ensureMicrosoftWatch(calendar: GoogleCalendar) {
  const address = webhookAddress();
  if (!address) return;
  if (calendar.watchExpiresAt && calendar.watchExpiresAt.getTime() > Date.now() + DAY) return;

  const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_HOURS * 3_600_000).toISOString();
  if (calendar.watchChannelId) {
    try {
      await graphFetch(calendar.connectionId, `/subscriptions/${enc(calendar.watchChannelId)}`, {
        method: 'PATCH',
        body: { expirationDateTime },
      });
      await prisma.googleCalendar.update({
        where: { id: calendar.id },
        data: { watchExpiresAt: new Date(expirationDateTime) },
      });
      return;
    } catch (error) {
      if (!(error instanceof GoogleApiError && error.status === 404)) throw error;
    }
  }

  const subscription = await graphFetch<{ id: string; expirationDateTime: string }>(
    calendar.connectionId,
    '/subscriptions',
    {
      method: 'POST',
      body: {
        changeType: 'created,updated,deleted',
        notificationUrl: address,
        resource: `me/calendars/${calendar.googleCalendarId}/events`,
        expirationDateTime,
        clientState: channelToken(calendar.id),
      },
    }
  );
  await prisma.googleCalendar.update({
    where: { id: calendar.id },
    data: {
      watchChannelId: subscription.id,
      watchExpiresAt: new Date(subscription.expirationDateTime),
    },
  });
}
