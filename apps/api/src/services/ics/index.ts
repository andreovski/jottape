import type { GoogleCalendar } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { decrypt, encrypt } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { userTimezone } from '@/services/finance';

import { fetchIcs, IcsFetchError, icsHost, normalizeIcsUrl } from './fetch';
import { type IcsOccurrence, parseIcs } from './parse';

// Agenda por link (ICS/webcal), como a do Outlook publicada quando a TI não libera o acesso pelo
// Graph. É uma "conta" GoogleConnection com provider ICS e um calendário só. A cada leitura o
// arquivo inteiro é expandido numa janela de datas (como a da Microsoft) e comparado com o que já
// está guardado: só o que mudou é gravado. Os eventos são só de leitura no Jottape.

/** Mesma janela da Microsoft: de 180 dias atrás a 1 ano à frente. */
const LOOKBACK_DAYS = 180;
const LOOKAHEAD_DAYS = 365;
const DAY = 86_400_000;

/** Erro de leitura vira 400 com a mensagem (que nunca leva o link). */
function asAppError(error: unknown): never {
  if (error instanceof IcsFetchError) throw new AppError(400, error.message);
  throw error;
}

function windowFor(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    from: new Date(today - LOOKBACK_DAYS * DAY),
    to: new Date(today + LOOKAHEAD_DAYS * DAY),
  };
}

async function download(userId: string, url: string, etag?: string | null) {
  const result = await fetchIcs(url, etag);
  if (result.notModified) return null;
  const window = windowFor();
  const parsed = parseIcs(result.text, {
    ...window,
    defaultTimeZone: await userTimezone(userId),
  });
  return { ...parsed, window, etag: result.etag };
}

const same = (a: Date, b: Date) => a.getTime() === b.getTime();

/** Grava as ocorrências do calendário: cria as novas, atualiza as mudadas, apaga as que sumiram. */
export async function applyIcsOccurrences(calendar: GoogleCalendar, items: IcsOccurrence[]) {
  const existing = await prisma.event.findMany({
    where: { calendarId: calendar.id },
    select: {
      id: true,
      googleEventId: true,
      title: true,
      description: true,
      location: true,
      startAt: true,
      endAt: true,
      allDay: true,
    },
  });
  const byKey = new Map(existing.map((event) => [event.googleEventId, event]));
  const wanted = new Set(items.map((item) => item.key));

  const toCreate: IcsOccurrence[] = [];
  const toUpdate: IcsOccurrence[] = [];
  for (const item of items) {
    const current = byKey.get(item.key);
    if (!current) toCreate.push(item);
    else if (
      current.title !== item.title ||
      current.description !== item.description ||
      current.location !== item.location ||
      current.allDay !== item.allDay ||
      !same(current.startAt, item.startAt) ||
      !same(current.endAt, item.endAt)
    ) {
      toUpdate.push(item);
    }
  }
  const toDelete = existing
    .filter((event) => !event.googleEventId || !wanted.has(event.googleEventId))
    .map((event) => event.id);

  const fields = (item: IcsOccurrence) => ({
    title: item.title,
    description: item.description,
    location: item.location,
    startAt: item.startAt,
    endAt: item.endAt,
    allDay: item.allDay,
  });

  await prisma.$transaction([
    prisma.event.deleteMany({ where: { id: { in: toDelete } } }),
    prisma.reminder.deleteMany({ where: { ownerType: 'EVENT', ownerId: { in: toDelete } } }),
    prisma.event.createMany({
      data: toCreate.map((item) => ({
        ...fields(item),
        userId: calendar.userId,
        source: 'ICS' as const,
        calendarId: calendar.id,
        googleEventId: item.key,
        status: 'CONFIRMED' as const,
        syncState: 'SYNCED' as const,
      })),
    }),
    ...toUpdate.map((item) =>
      prisma.event.update({
        where: { calendarId_googleEventId: { calendarId: calendar.id, googleEventId: item.key } },
        data: fields(item),
      })
    ),
  ]);
  return { created: toCreate.length, updated: toUpdate.length, deleted: toDelete.length };
}

/**
 * Lê o link de novo. O ETag só vale no mesmo dia da última leitura completa: num dia novo a janela
 * andou e o arquivo precisa ser expandido de novo, mesmo sem mudança.
 */
export async function syncIcsConnection(connectionId: string) {
  const connection = await prisma.googleConnection.findUnique({
    where: { id: connectionId },
    include: { calendars: true },
  });
  if (!connection || connection.provider !== 'ICS') return;
  const calendar = connection.calendars[0];
  if (!calendar) return;

  const window = windowFor();
  const sameWindow = calendar.syncWindowStart && same(calendar.syncWindowStart, window.from);
  const result = await download(
    connection.userId,
    decrypt(connection.refreshTokenEncrypted),
    sameWindow ? calendar.syncToken : null
  );
  if (result) {
    await applyIcsOccurrences(calendar, result.occurrences);
  }
  await prisma.googleCalendar.update({
    where: { id: calendar.id },
    data: {
      syncedAt: new Date(),
      ...(result ? { syncToken: result.etag, syncWindowStart: result.window.from } : {}),
    },
  });
}

/** Todas as agendas por link, de todo mundo (job de 5 em 5 minutos). Uma com erro não para as outras. */
export async function syncAllIcs() {
  const connections = await prisma.googleConnection.findMany({
    where: { provider: 'ICS' },
    select: { id: true },
  });
  for (const { id } of connections) {
    try {
      await prisma.googleConnection.update({ where: { id }, data: { lastError: null } });
      await syncIcsConnection(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao ler a agenda.';
      await prisma.googleConnection
        .update({ where: { id }, data: { lastError: message.slice(0, 500) } })
        .catch(() => undefined);
    }
  }
}

async function assertNotDuplicate(userId: string, url: string, exceptId?: string) {
  const others = await prisma.googleConnection.findMany({
    where: { userId, provider: 'ICS', ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (others.some((other) => decrypt(other.refreshTokenEncrypted) === url)) {
    throw new AppError(409, 'Essa agenda já foi adicionada.');
  }
}

function parseUrl(input: string) {
  const url = normalizeIcsUrl(input);
  if (!url) throw new AppError(400, 'Cole um link que comece com https:// ou webcal://.');
  return url;
}

/** Adiciona a agenda: lê o link na hora (link errado nem chega a ser salvo). */
export async function addIcsCalendar(
  userId: string,
  body: { url: string; name?: string | null; color?: string | null }
) {
  const url = parseUrl(body.url);
  await assertNotDuplicate(userId, url);
  const result = await download(userId, url).catch(asAppError);
  if (!result) throw new AppError(400, 'Não deu para ler a agenda.');

  const name = body.name?.trim() || result.name?.trim() || 'Agenda por link';
  const connection = await prisma.googleConnection.create({
    data: {
      userId,
      provider: 'ICS',
      googleEmail: icsHost(url),
      refreshTokenEncrypted: encrypt(url),
      scope: 'ics',
      calendars: {
        create: {
          userId,
          googleCalendarId: `ics:${randomUUID()}`,
          name: name.slice(0, 80),
          colorOverride: body.color ?? null,
          selected: true,
          syncToken: result.etag,
          syncWindowStart: result.window.from,
          syncedAt: new Date(),
        },
      },
    },
    include: { calendars: true },
  });
  await applyIcsOccurrences(connection.calendars[0], result.occurrences);
  return connection;
}

/** Renomeia ou troca o link (um link novo é lido na hora, e os eventos são refeitos). */
export async function updateIcsCalendar(
  userId: string,
  connectionId: string,
  body: { url?: string; name?: string }
) {
  const connection = await prisma.googleConnection.findFirst({
    where: { id: connectionId, userId, provider: 'ICS' },
    include: { calendars: true },
  });
  const calendar = connection?.calendars[0];
  if (!connection || !calendar) throw new AppError(404, 'Agenda não encontrada.');

  if (body.name?.trim()) {
    await prisma.googleCalendar.update({
      where: { id: calendar.id },
      data: { name: body.name.trim().slice(0, 80) },
    });
  }
  if (body.url !== undefined) {
    const url = parseUrl(body.url);
    if (url !== decrypt(connection.refreshTokenEncrypted)) {
      await assertNotDuplicate(userId, url, connection.id);
      const result = await download(userId, url).catch(asAppError);
      if (!result) throw new AppError(400, 'Não deu para ler a agenda.');
      await prisma.googleConnection.update({
        where: { id: connection.id },
        data: { refreshTokenEncrypted: encrypt(url), googleEmail: icsHost(url), lastError: null },
      });
      await applyIcsOccurrences(calendar, result.occurrences);
      await prisma.googleCalendar.update({
        where: { id: calendar.id },
        data: { syncToken: result.etag, syncWindowStart: result.window.from, syncedAt: new Date() },
      });
    }
  }
}
