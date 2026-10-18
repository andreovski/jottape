import { type GoogleStatusResponse, updateGoogleCalendarsBodySchema } from '@jottape/schemas';
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
  syncAllCalendars,
  syncCalendar,
} from '@/services/google/calendar';
import {
  authorizationUrl,
  exchangeCode,
  fetchUserInfo,
  forgetAccessToken,
  REVOKE_URL,
} from '@/services/google/client';
import { syncTasks } from '@/services/google/tasks';

import { authenticate, sessionUserId, startSession } from '../session';

const STATE_COOKIE = 'jottape_oauth';

/** Sincroniza em segundo plano (a resposta não espera o Google). Nos testes, nada. */
function background(job: () => Promise<unknown>) {
  if (process.env.NODE_ENV === 'test') return;
  void job().catch((error) => console.error('[google]', error));
}

export async function googleStatus(userId: string): Promise<GoogleStatusResponse> {
  const [connection, calendars] = await Promise.all([
    prisma.googleConnection.findUnique({ where: { userId } }),
    prisma.googleCalendar.findMany({
      where: { userId },
      orderBy: [{ primary: 'desc' }, { name: 'asc' }],
    }),
  ]);
  return {
    configured: Boolean(getGoogleConfig()),
    connected: Boolean(connection),
    email: connection?.googleEmail ?? null,
    calendars: calendars.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      primary: c.primary,
      selected: c.selected,
      syncedAt: c.syncedAt?.toISOString() ?? null,
    })),
    defaultCalendarId: connection?.defaultCalendarId ?? null,
    tasksSyncedAt: connection?.tasksSyncedAt?.toISOString() ?? null,
    lastError: connection?.lastError ?? null,
  };
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
      // Uso pessoal: só entra a conta Google já ligada ou a do e-mail do dono.
      const user = await prisma.user.findFirst({
        where: {
          OR: [{ googleSub: info.sub }, ...(info.email_verified !== false ? [{ email }] : [])],
        },
      });
      if (!user) return reply.redirect(`${back}?erro=conta`);
      if (!user.googleSub)
        await prisma.user.update({ where: { id: user.id }, data: { googleSub: info.sub } });
      await startSession(reply, user.id);
      return reply.redirect(`${appUrl}/`);
    }

    const userId = state.sub;
    const existing = await prisma.googleConnection.findUnique({ where: { userId } });
    const refresh =
      token.refresh_token ?? (existing ? decrypt(existing.refreshTokenEncrypted) : null);
    if (!refresh) return reply.redirect(`${back}?erro=google`);

    await prisma.googleConnection.upsert({
      where: { userId },
      update: {
        googleEmail: email,
        refreshTokenEncrypted: encrypt(refresh),
        scope: token.scope,
        lastError: null,
      },
      create: {
        userId,
        googleEmail: email,
        refreshTokenEncrypted: encrypt(refresh),
        scope: token.scope,
      },
    });
    forgetAccessToken(userId);
    await prisma.user.updateMany({
      where: { id: userId, googleSub: null },
      data: { googleSub: info.sub },
    });

    background(async () => {
      await syncAllCalendars(userId);
      await syncTasks(userId);
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
      const calendars = await prisma.googleCalendar.findMany({ where: { userId: request.userId } });
      const ids = new Set(calendars.map((c) => c.id));
      if (body.defaultCalendarId && !ids.has(body.defaultCalendarId)) {
        throw new AppError(404, 'Calendário não encontrado.');
      }
      for (const calendar of calendars) {
        const selected = body.selectedIds.includes(calendar.id);
        if (selected !== calendar.selected) {
          await prisma.googleCalendar.update({ where: { id: calendar.id }, data: { selected } });
          if (!selected) await stopWatch(calendar).catch(() => undefined);
        }
      }
      await prisma.googleConnection.update({
        where: { userId: request.userId },
        data: { defaultCalendarId: body.defaultCalendarId },
      });
      const userId = request.userId;
      background(() => syncAllCalendars(userId));
      return googleStatus(userId);
    });

    privateRoutes.post('/google/sync', async (request) => {
      await syncAllCalendars(request.userId);
      await syncTasks(request.userId);
      return googleStatus(request.userId);
    });

    privateRoutes.delete('/google', async (request, reply) => {
      const userId = request.userId;
      const connection = await prisma.googleConnection.findUnique({ where: { userId } });
      if (!connection) return reply.status(204).send();

      const calendars = await prisma.googleCalendar.findMany({ where: { userId } });
      for (const calendar of calendars) await stopWatch(calendar).catch(() => undefined);
      await fetch(
        `${REVOKE_URL}?token=${encodeURIComponent(decrypt(connection.refreshTokenEncrypted))}`,
        {
          method: 'POST',
        }
      ).catch(() => undefined);

      // Os eventos do Google somem com os calendários; as tarefas ficam, só sem o vínculo.
      await prisma.$transaction([
        prisma.googleCalendar.deleteMany({ where: { userId } }),
        prisma.task.deleteMany({ where: { userId, deletedAt: { not: null } } }),
        prisma.task.updateMany({
          where: { userId },
          data: { googleTaskId: null, googleEtag: null, syncState: 'PENDING' },
        }),
        prisma.taskList.updateMany({
          where: { userId },
          data: { googleTaskListId: null, syncState: 'PENDING' },
        }),
        prisma.googleConnection.delete({ where: { userId } }),
      ]);
      forgetAccessToken(userId);
      return reply.status(204).send();
    });
  });
}
