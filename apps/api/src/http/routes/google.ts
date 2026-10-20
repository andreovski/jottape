import {
  type GoogleStatusResponse,
  updateGoogleCalendarsBodySchema,
  updateGoogleTasksAccountBodySchema,
} from '@jottape/schemas';
import type { GoogleConnection } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { decrypt, encrypt } from '@/lib/crypto';
import { getAppUrl, getGoogleConfig, isSecureCookie } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import {
  channelToken,
  stopWatch,
  syncAccount,
  syncAllCalendars,
  syncCalendar,
} from '@/services/google/calendar';
import {
  authorizationUrl,
  connectionsOf,
  exchangeCode,
  fetchUserInfo,
  forgetAccessToken,
  RECONNECT_MESSAGE,
  REVOKE_URL,
} from '@/services/google/client';
import { syncTasks, unlinkTasksOps } from '@/services/google/tasks';

import { authenticate, sessionUserId, startSession } from '../session';

const STATE_COOKIE = 'jottape_oauth';

/** Sincroniza em segundo plano (a resposta não espera o Google). Nos testes, nada. */
function background(job: () => Promise<unknown>) {
  if (process.env.NODE_ENV === 'test') return;
  void job().catch((error) => console.error('[google]', error));
}

export async function googleStatus(userId: string): Promise<GoogleStatusResponse> {
  const [accounts, calendars, user] = await Promise.all([
    connectionsOf(userId),
    prisma.googleCalendar.findMany({
      where: { userId },
      orderBy: [{ primary: 'desc' }, { name: 'asc' }],
    }),
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
  ]);
  const order = new Map(accounts.map((account, index) => [account.id, index]));
  const visible = calendars
    .filter((c) => order.has(c.connectionId))
    .sort((x, y) => order.get(x.connectionId)! - order.get(y.connectionId)!);
  const tasksAccount = accounts.find((a) => a.syncTasks) ?? null;
  const main = tasksAccount ?? accounts[0] ?? null;

  return {
    configured: Boolean(getGoogleConfig()),
    connected: accounts.length > 0,
    accounts: accounts.map((a) => ({
      id: a.id,
      email: a.googleEmail,
      syncTasks: a.syncTasks,
      tasksSyncedAt: a.tasksSyncedAt?.toISOString() ?? null,
      lastError: a.lastError,
      needsReconnect: a.lastError === RECONNECT_MESSAGE,
    })),
    calendars: visible.map((c) => ({
      id: c.id,
      accountId: c.connectionId,
      name: c.name,
      color: c.colorOverride ?? c.color,
      colorOverride: c.colorOverride,
      primary: c.primary,
      selected: c.selected,
      syncedAt: c.syncedAt?.toISOString() ?? null,
      alsoIn: visible
        .filter((o) => o.googleCalendarId === c.googleCalendarId && o.id !== c.id)
        .map((o) => o.id),
    })),
    defaultCalendarId: visible.some((c) => c.id === user.defaultCalendarId)
      ? user.defaultCalendarId
      : null,
    tasksAccountId: tasksAccount?.id ?? null,
    email: main?.googleEmail ?? null,
    tasksSyncedAt: tasksAccount?.tasksSyncedAt?.toISOString() ?? null,
    lastError: accounts.find((a) => a.lastError)?.lastError ?? null,
  };
}

/** Desconecta uma conta: para os webhooks, revoga o token e apaga calendários e eventos dela. */
async function disconnectAccount(connection: GoogleConnection) {
  const { userId } = connection;
  const calendars = await prisma.googleCalendar.findMany({
    where: { connectionId: connection.id },
  });
  for (const calendar of calendars) await stopWatch(calendar).catch(() => undefined);
  await fetch(
    `${REVOKE_URL}?token=${encodeURIComponent(decrypt(connection.refreshTokenEncrypted))}`,
    { method: 'POST' }
  ).catch(() => undefined);

  // Os eventos do Google somem com os calendários; as tarefas ficam, só sem o vínculo.
  await prisma.$transaction([
    ...(connection.syncTasks ? unlinkTasksOps(userId) : []),
    prisma.googleConnection.delete({ where: { id: connection.id } }),
  ]);
  forgetAccessToken(connection.id);

  // O calendário padrão era desta conta: passa para o principal de outra que esteja marcado.
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.defaultCalendarId) {
    const next = await prisma.googleCalendar.findFirst({
      where: { userId, selected: true },
      orderBy: [{ primary: 'desc' }, { createdAt: 'asc' }],
    });
    if (next) {
      await prisma.user.update({ where: { id: userId }, data: { defaultCalendarId: next.id } });
    }
  }
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function googleRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------ OAuth (login e conexão)

  app.get('/google/auth', async (request, reply) => {
    const { intent } = z
      .object({ intent: z.enum(['login', 'connect']).default('login') })
      .parse(request.query);
    if (!getGoogleConfig()) throw new AppError(404, 'Login com Google não está configurado.');

    const uid = intent === 'connect' ? await sessionUserId(request) : null;
    if (intent === 'connect' && !uid) return reply.status(401).send({ message: 'Unauthorized.' });

    const nonce = randomBytes(16).toString('hex');
    const state = app.jwt.sign({ sub: uid ?? '', intent, nonce } as never, { expiresIn: '10m' });
    reply.setCookie(STATE_COOKIE, nonce, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecureCookie(),
      maxAge: 600,
    });
    return reply.redirect(authorizationUrl(state, intent));
  });

  app.get('/google/callback', async (request: FastifyRequest, reply) => {
    const query = z
      .object({ code: z.string().optional(), state: z.string(), error: z.string().optional() })
      .parse(request.query);
    const appUrl = getAppUrl();

    let state: { sub: string; intent: 'login' | 'connect'; nonce: string };
    try {
      state = app.jwt.verify<typeof state>(query.state);
    } catch {
      return reply.redirect(`${appUrl}/entrar?erro=google`);
    }
    const back = state.intent === 'login' ? `${appUrl}/entrar` : `${appUrl}/ajustes`;
    const cookieNonce = request.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: '/' });
    if (!cookieNonce || !safeEqual(cookieNonce, state.nonce) || query.error || !query.code) {
      return reply.redirect(`${back}?erro=google`);
    }

    const token = await exchangeCode(query.code);
    const info = await fetchUserInfo(token.access_token);
    const email = info.email.toLowerCase();

    if (state.intent === 'login') {
      // Só entra quem já tem conta (Google ligado, uma conta conectada ou o mesmo e-mail): o login
      // não cria usuário.
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { googleSub: info.sub },
            { googleConnections: { some: { googleSub: info.sub } } },
            ...(info.email_verified !== false ? [{ email }] : []),
          ],
        },
      });
      if (!user) return reply.redirect(`${back}?erro=conta`);
      if (!user.googleSub)
        await prisma.user.update({ where: { id: user.id }, data: { googleSub: info.sub } });
      await startSession(reply, user.id);
      return reply.redirect(`${appUrl}/`);
    }

    const userId = state.sub;
    // Uma conta Google fica ligada a um usuário do Jottape por vez.
    const usedElsewhere = await prisma.googleConnection.count({
      where: { googleSub: info.sub, userId: { not: userId } },
    });
    if (usedElsewhere) return reply.redirect(`${back}?erro=conta-em-uso`);

    // Reconectar a mesma conta só renova o token (contas antigas ainda sem `sub`: pelo e-mail).
    const existing = await prisma.googleConnection.findFirst({
      where: {
        userId,
        OR: [{ googleSub: info.sub }, { googleSub: null, googleEmail: email }],
      },
    });
    const refresh =
      token.refresh_token ?? (existing ? decrypt(existing.refreshTokenEncrypted) : null);
    if (!refresh) return reply.redirect(`${back}?erro=google`);

    const fields = {
      googleSub: info.sub,
      googleEmail: email,
      refreshTokenEncrypted: encrypt(refresh),
      scope: token.scope,
      lastError: null,
    };
    const connection = existing
      ? await prisma.googleConnection.update({ where: { id: existing.id }, data: fields })
      : await prisma.googleConnection.create({
          data: {
            ...fields,
            userId,
            // A primeira conta sincroniza o Google Tasks; as outras só a agenda.
            syncTasks: (await prisma.googleConnection.count({ where: { userId } })) === 0,
          },
        });
    forgetAccessToken(connection.id);
    await prisma.user.updateMany({
      where: { id: userId, googleSub: null },
      data: { googleSub: info.sub },
    });

    background(async () => {
      await syncAccount(connection.id);
      if (connection.syncTasks) await syncTasks(userId);
    });
    return reply.redirect(`${back}?google=ok`);
  });

  // ------------------------------------------------------------ webhook do Calendar

  app.post('/google/webhook', async (request, reply) => {
    const channelId = request.headers['x-goog-channel-id'];
    const token = request.headers['x-goog-channel-token'];
    const state = request.headers['x-goog-resource-state'];
    if (typeof channelId !== 'string' || typeof token !== 'string') return reply.status(400).send();
    if (!safeEqual(token, channelToken(channelId))) return reply.status(403).send();

    const calendar = await prisma.googleCalendar.findUnique({
      where: { watchChannelId: channelId },
    });
    if (calendar && state !== 'sync') background(() => syncCalendar(calendar.id));
    return reply.status(200).send();
  });

  // ------------------------------------------------------------ privadas

  app.register(async (privateRoutes) => {
    privateRoutes.addHook('preHandler', authenticate);

    privateRoutes.get('/google/status', async (request) => googleStatus(request.userId));

    privateRoutes.put('/google/calendars', async (request) => {
      const body = updateGoogleCalendarsBodySchema.parse(request.body);
      const userId = request.userId;
      const calendars = await prisma.googleCalendar.findMany({ where: { userId } });
      const ids = new Set(calendars.map((c) => c.id));
      if (body.defaultCalendarId && !ids.has(body.defaultCalendarId)) {
        throw new AppError(404, 'Calendário não encontrado.');
      }
      for (const calendar of calendars) {
        const selected = body.selectedIds.includes(calendar.id);
        const color =
          body.colors && calendar.id in body.colors ? body.colors[calendar.id] : undefined;
        if (selected !== calendar.selected || color !== undefined) {
          await prisma.googleCalendar.update({
            where: { id: calendar.id },
            data: { selected, ...(color !== undefined ? { colorOverride: color } : {}) },
          });
        }
        if (calendar.selected && !selected) await stopWatch(calendar).catch(() => undefined);
      }
      await prisma.user.update({
        where: { id: userId },
        data: { defaultCalendarId: body.defaultCalendarId },
      });
      background(() => syncAllCalendars(userId));
      return googleStatus(userId);
    });

    privateRoutes.put('/google/tasks-account', async (request) => {
      const { accountId } = updateGoogleTasksAccountBodySchema.parse(request.body);
      const userId = request.userId;
      const accounts = await connectionsOf(userId);
      if (accountId && !accounts.some((a) => a.id === accountId)) {
        throw new AppError(404, 'Conta não encontrada.');
      }
      const current = accounts.find((a) => a.syncTasks);
      if ((current?.id ?? null) === accountId) return googleStatus(userId);

      // Trocar de conta: as tarefas perdem o vínculo com a anterior e sobem para a nova.
      await prisma.$transaction([
        ...unlinkTasksOps(userId),
        prisma.googleConnection.updateMany({
          where: { userId },
          data: { syncTasks: false, tasksSyncedAt: null },
        }),
        ...(accountId
          ? [
              prisma.googleConnection.update({
                where: { id: accountId },
                data: { syncTasks: true },
              }),
            ]
          : []),
      ]);
      if (accountId) await syncTasks(userId);
      return googleStatus(userId);
    });

    privateRoutes.post('/google/sync', async (request) => {
      await syncAllCalendars(request.userId);
      await syncTasks(request.userId);
      return googleStatus(request.userId);
    });

    privateRoutes.post('/google/accounts/:id/sync', async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const connection = await prisma.googleConnection.findFirst({
        where: { id, userId: request.userId },
      });
      if (!connection) throw new AppError(404, 'Conta não encontrada.');
      await syncAccount(connection.id);
      if (connection.syncTasks) await syncTasks(request.userId);
      return googleStatus(request.userId);
    });

    privateRoutes.delete('/google/accounts/:id', async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const connection = await prisma.googleConnection.findFirst({
        where: { id, userId: request.userId },
      });
      if (!connection) throw new AppError(404, 'Conta não encontrada.');
      await disconnectAccount(connection);
      return reply.status(204).send();
    });

    /** Desconecta todas as contas. */
    privateRoutes.delete('/google', async (request, reply) => {
      const connections = await prisma.googleConnection.findMany({
        where: { userId: request.userId },
      });
      for (const connection of connections) await disconnectAccount(connection);
      return reply.status(204).send();
    });
  });
}
