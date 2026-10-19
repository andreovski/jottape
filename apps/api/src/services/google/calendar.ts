import type { Event, GoogleCalendar } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';

import { getAppUrl, getJwtSecret } from '@/lib/env';
import { prisma } from '@/lib/prisma';

import {
  connectionsOf,
  ensureGoogleSub,
  GoogleApiError,
  googleFetch,
  isConnectionActive,
  recordError,
} from './client';

const API = 'https://www.googleapis.com/calendar/v3';
/** Primeira sincronização de um calendário traz a partir de 180 dias atrás. */
const INITIAL_LOOKBACK_DAYS = 180;

interface GoogleDate {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleDate;
  end?: GoogleDate;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleDate;
}

interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  summaryOverride?: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole?: string;
}

const enc = (value: string) => encodeURIComponent(value);

function parseGoogleDate(value: GoogleDate | undefined): { at: Date; allDay: boolean } | null {
  if (value?.dateTime) return { at: new Date(value.dateTime), allDay: false };
  if (value?.date) return { at: new Date(`${value.date}T00:00:00.000Z`), allDay: true };
  return null;
}

function ruleFromRecurrence(recurrence: string[] | undefined): string | null {
  const line = recurrence?.find((r) => r.startsWith('RRULE:'));
  return line ? line.slice('RRULE:'.length) : null;
}

/** Token do canal do webhook: prova que a notificação veio de um canal que nós criamos. */
export function channelToken(channelId: string) {
  return createHmac('sha256', getJwtSecret()).update(channelId).digest('hex');
}

// ---------------------------------------------------------------- lista de calendários

/** Lista de calendários de uma conta. Calendário que já existe noutra conta chega desmarcado. */
export async function syncCalendarList(connectionId: string) {
  const { userId } = await prisma.googleConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });
  const data = await googleFetch<{ items: GoogleCalendarListEntry[] }>(
    connectionId,
    `${API}/users/me/calendarList`,
    { query: { minAccessRole: 'reader' } }
  );
  const seen: string[] = [];
  for (const item of data.items ?? []) {
    seen.push(item.id);
    const elsewhere = await prisma.googleCalendar.count({
      where: { userId, googleCalendarId: item.id, connectionId: { not: connectionId } },
    });
    await prisma.googleCalendar.upsert({
      where: { connectionId_googleCalendarId: { connectionId, googleCalendarId: item.id } },
      update: {
        name: item.summaryOverride ?? item.summary,
        color: item.backgroundColor ?? null,
        primary: Boolean(item.primary),
      },
      create: {
        userId,
        connectionId,
        googleCalendarId: item.id,
        name: item.summaryOverride ?? item.summary,
        color: item.backgroundColor ?? null,
        primary: Boolean(item.primary),
        // Na primeira conexão só o principal vem marcado (e nunca um repetido de outra conta).
        selected: Boolean(item.primary) && elsewhere === 0,
      },
    });
  }
  await prisma.googleCalendar.deleteMany({
    where: { connectionId, googleCalendarId: { notIn: seen } },
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

// ---------------------------------------------------------------- Google -> Jottape

async function applyRemoteEvent(calendar: GoogleCalendar, item: GoogleEvent) {
  const existing = await prisma.event.findUnique({
    where: { calendarId_googleEventId: { calendarId: calendar.id, googleEventId: item.id } },
  });
  // Edição local ainda não enviada vence: o push manda a versão do Jottape.
  if (existing?.syncState === 'PENDING') return;

  if (item.status === 'cancelled' && !item.recurringEventId) {
    if (existing) await prisma.event.delete({ where: { id: existing.id } });
    return;
  }

  let master: Event | null = null;
  if (item.recurringEventId) {
    master = await prisma.event.findUnique({
      where: {
        calendarId_googleEventId: { calendarId: calendar.id, googleEventId: item.recurringEventId },
      },
    });
    if (!master) return;
  }

  const original = parseGoogleDate(item.originalStartTime);
  const start = parseGoogleDate(item.start) ?? original;
  const end = parseGoogleDate(item.end);
  if (!start) return;

  const data = {
    title: item.summary || master?.title || '(sem título)',
    description: item.description ?? null,
    location: item.location ?? null,
    startAt: start.at,
    endAt: end?.at ?? new Date(start.at.getTime() + (start.allDay ? 86_400_000 : 3_600_000)),
    allDay: start.allDay,
    rrule: master ? null : ruleFromRecurrence(item.recurrence),
    status: item.status === 'cancelled' ? ('CANCELLED' as const) : ('CONFIRMED' as const),
    recurringEventId: master?.id ?? null,
    originalStartAt: master ? (original?.at ?? start.at) : null,
    etag: item.etag ?? null,
    syncState: 'SYNCED' as const,
  };

  if (existing) {
    await prisma.event.update({ where: { id: existing.id }, data });
  } else {
    await prisma.event.create({
      data: {
        ...data,
        userId: calendar.userId,
        source: 'GOOGLE',
        calendarId: calendar.id,
        googleEventId: item.id,
      },
    });
  }
}

/** Sincroniza um calendário: incremental com syncToken; completa quando o token expira (410). */
export async function syncCalendar(calendarId: string): Promise<void> {
  const calendar = await prisma.googleCalendar.findUnique({ where: { id: calendarId } });
  if (!calendar) return;

  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  try {
    do {
      const page = await googleFetch<{
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      }>(calendar.connectionId, `${API}/calendars/${enc(calendar.googleCalendarId)}/events`, {
        query: {
          maxResults: '250',
          showDeleted: 'true',
          pageToken,
          ...(calendar.syncToken
            ? { syncToken: calendar.syncToken }
            : {
                timeMin: new Date(Date.now() - INITIAL_LOOKBACK_DAYS * 86_400_000).toISOString(),
              }),
        },
      });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 410) {
      await prisma.event.deleteMany({ where: { calendarId, syncState: 'SYNCED' } });
      await prisma.googleCalendar.update({ where: { id: calendarId }, data: { syncToken: null } });
      return syncCalendar(calendarId);
    }
    throw error;
  }

  // Mestres antes das exceções: a exceção aponta para o mestre.
  for (const item of items.filter((i) => !i.recurringEventId))
    await applyRemoteEvent(calendar, item);
  for (const item of items.filter((i) => i.recurringEventId))
    await applyRemoteEvent(calendar, item);

  await prisma.googleCalendar.update({
    where: { id: calendarId },
    data: { syncToken: nextSyncToken ?? calendar.syncToken, syncedAt: new Date() },
  });
}

// ---------------------------------------------------------------- Jottape -> Google

function googleTimes(event: Event, timeZone: string) {
  if (event.allDay) {
    return {
      start: { date: event.startAt.toISOString().slice(0, 10) },
      end: { date: event.endAt.toISOString().slice(0, 10) },
    };
  }
  return {
    start: { dateTime: event.startAt.toISOString(), timeZone },
    end: { dateTime: event.endAt.toISOString(), timeZone },
  };
}

/** Id da instância de um evento recorrente no Google: `<mestre>_<início original em UTC>`. */
export function instanceId(masterGoogleId: string, originalStart: Date, allDay: boolean) {
  const iso = originalStart
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return `${masterGoogleId}_${allDay ? iso.slice(0, 8) : iso}`;
}

/** Envia o evento (criação, edição, cancelamento de ocorrência). Falha fica marcada como ERROR. */
export async function pushEventToGoogle(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { calendar: true, user: true, recurring: true },
  });
  if (!event?.calendar || !(await isConnectionActive(event.calendar.connectionId))) return;
  const connectionId = event.calendar.connectionId;
  const base = `${API}/calendars/${enc(event.calendar.googleCalendarId)}/events`;

  try {
    let result: GoogleEvent | null;

    if (event.recurring) {
      if (!event.recurring.googleEventId) await pushEventToGoogle(event.recurring.id);
      const master = await prisma.event.findUniqueOrThrow({ where: { id: event.recurring.id } });
      if (!master.googleEventId) return;
      const id =
        event.googleEventId ??
        instanceId(master.googleEventId, event.originalStartAt!, master.allDay);
      result = await googleFetch<GoogleEvent>(connectionId, `${base}/${enc(id)}`, {
        method: 'PATCH',
        body:
          event.status === 'CANCELLED'
            ? { status: 'cancelled' }
            : {
                summary: event.title,
                description: event.description,
                location: event.location,
                status: 'confirmed',
                ...googleTimes(event, event.user.timezone),
              },
      });
    } else {
      const body = {
        summary: event.title,
        description: event.description,
        location: event.location,
        ...googleTimes(event, event.user.timezone),
        recurrence: event.rrule ? [`RRULE:${event.rrule}`] : [],
      };
      result = event.googleEventId
        ? await googleFetch<GoogleEvent>(connectionId, `${base}/${enc(event.googleEventId)}`, {
            method: 'PATCH',
            body,
          })
        : await googleFetch<GoogleEvent>(connectionId, base, { method: 'POST', body });
    }

    await prisma.event.update({
      where: { id: event.id },
      data: {
        googleEventId: result?.id ?? event.googleEventId,
        etag: result?.etag ?? event.etag,
        syncState: 'SYNCED',
      },
    });
  } catch (error) {
    await prisma.event.update({ where: { id: event.id }, data: { syncState: 'ERROR' } });
    await recordError(connectionId, error);
  }
}

export async function deleteEventFromGoogle(event: Event): Promise<void> {
  if (!event.calendarId || !event.googleEventId) return;
  const calendar = await prisma.googleCalendar.findUnique({ where: { id: event.calendarId } });
  if (!calendar || !(await isConnectionActive(calendar.connectionId))) return;
  try {
    await googleFetch(
      calendar.connectionId,
      `${API}/calendars/${enc(calendar.googleCalendarId)}/events/${enc(event.googleEventId)}`,
      { method: 'DELETE' }
    );
  } catch (error) {
    if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return;
    await recordError(calendar.connectionId, error);
  }
}

// ---------------------------------------------------------------- webhook (events.watch)

/** O Google só aceita webhook em HTTPS público: em dev o fallback periódico cobre. */
function webhookAddress(): string | null {
  const url = `${getAppUrl()}/api/google/webhook`;
  return url.startsWith('https://') ? url : null;
}

export async function stopWatch(calendar: GoogleCalendar) {
  if (!calendar.watchChannelId || !calendar.watchResourceId) return;
  await googleFetch(calendar.connectionId, `${API}/channels/stop`, {
    method: 'POST',
    body: { id: calendar.watchChannelId, resourceId: calendar.watchResourceId },
  }).catch(() => undefined);
  await prisma.googleCalendar.update({
    where: { id: calendar.id },
    data: { watchChannelId: null, watchResourceId: null, watchExpiresAt: null },
  });
}

/** Garante um canal ativo no calendário, renovando o que vence em menos de 1 dia. */
export async function ensureWatch(calendar: GoogleCalendar) {
  const address = webhookAddress();
  if (!address) return;
  if (calendar.watchExpiresAt && calendar.watchExpiresAt.getTime() > Date.now() + 86_400_000)
    return;

  await stopWatch(calendar);
  const id = randomUUID();
  const channel = await googleFetch<{ resourceId: string; expiration: string }>(
    calendar.connectionId,
    `${API}/calendars/${enc(calendar.googleCalendarId)}/events/watch`,
    { method: 'POST', body: { id, type: 'web_hook', address, token: channelToken(id) } }
  );
  await prisma.googleCalendar.update({
    where: { id: calendar.id },
    data: {
      watchChannelId: id,
      watchResourceId: channel.resourceId,
      watchExpiresAt: new Date(Number(channel.expiration)),
    },
  });
}

/** Sincronização de uma conta: lista, calendários marcados, pendências locais, webhooks. */
export async function syncAccount(connectionId: string) {
  await prisma.googleConnection.update({ where: { id: connectionId }, data: { lastError: null } });
  try {
    await ensureGoogleSub(connectionId).catch(() => undefined);
    await syncCalendarList(connectionId);
    const calendars = await prisma.googleCalendar.findMany({ where: { connectionId } });
    for (const calendar of calendars) {
      if (calendar.selected) {
        await syncCalendar(calendar.id);
        await ensureWatch(calendar).catch((error) => recordError(connectionId, error));
      } else if (calendar.watchChannelId) {
        await stopWatch(calendar);
      }
    }

    const pending = await prisma.event.findMany({
      where: { calendar: { connectionId }, syncState: { in: ['PENDING', 'ERROR'] } },
      orderBy: { recurringEventId: { sort: 'asc', nulls: 'first' } },
    });
    for (const event of pending) await pushEventToGoogle(event.id);
  } catch (error) {
    await recordError(connectionId, error);
  }
}

/** Sincroniza todas as contas do usuário; uma conta com problema não segura as outras. */
export async function syncAllCalendars(userId: string) {
  for (const connection of await connectionsOf(userId)) await syncAccount(connection.id);
}
