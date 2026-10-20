import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { decrypt, encrypt } from '@/lib/crypto';
import { getAppUrl, getMicrosoftConfig, isSecureCookie } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { channelToken, syncAccount } from '@/services/google/calendar';
import { syncMicrosoftCalendar } from '@/services/microsoft/calendar';
import {
  exchangeMicrosoftCode,
  fetchMicrosoftProfile,
  forgetMicrosoftAccessToken,
  microsoftAuthorizationUrl,
} from '@/services/microsoft/client';

import { sessionUserId } from '../session';
import { background, safeEqual, STATE_COOKIE } from './google';

// Conectar uma conta da Microsoft (Outlook, Hotmail, Microsoft 365) só para a Agenda. Não há login
// com Microsoft nem tarefas (To Do): isso continua com o Google.
export async function microsoftRoutes(app: FastifyInstance) {
  app.get('/microsoft/auth', async (request, reply) => {
    if (!getMicrosoftConfig()) throw new AppError(404, 'A Microsoft não está configurada.');
    const uid = await sessionUserId(request);
    if (!uid) return reply.status(401).send({ message: 'Unauthorized.' });

    const nonce = randomBytes(16).toString('hex');
    const state = app.jwt.sign({ sub: uid, intent: 'microsoft', nonce } as never, {
      expiresIn: '10m',
    });
    reply.setCookie(STATE_COOKIE, nonce, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecureCookie(),
      maxAge: 600,
    });
    return reply.redirect(microsoftAuthorizationUrl(state));
  });

  app.get('/microsoft/callback', async (request, reply) => {
    const query = z
      .object({ code: z.string().optional(), state: z.string(), error: z.string().optional() })
      .parse(request.query);
    const back = `${getAppUrl()}/ajustes/google`;

    let state: { sub: string; intent: string; nonce: string };
    try {
      state = app.jwt.verify<typeof state>(query.state);
    } catch {
      return reply.redirect(`${back}?erro=microsoft`);
    }
    const cookieNonce = request.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: '/' });
    if (
      state.intent !== 'microsoft' ||
      !cookieNonce ||
      !safeEqual(cookieNonce, state.nonce) ||
      query.error ||
      !query.code
    ) {
      return reply.redirect(`${back}?erro=microsoft`);
    }

    const token = await exchangeMicrosoftCode(query.code);
    const profile = await fetchMicrosoftProfile(token.access_token);
    const userId = state.sub;

    const usedElsewhere = await prisma.googleConnection.count({
      where: { provider: 'MICROSOFT', googleSub: profile.id, userId: { not: userId } },
    });
    if (usedElsewhere) return reply.redirect(`${back}?erro=conta-em-uso`);

    const existing = await prisma.googleConnection.findFirst({
      where: { userId, provider: 'MICROSOFT', googleSub: profile.id },
    });
    const refresh =
      token.refresh_token ?? (existing ? decrypt(existing.refreshTokenEncrypted) : null);
    if (!refresh) return reply.redirect(`${back}?erro=microsoft`);

    const fields = {
      googleEmail: profile.email,
      refreshTokenEncrypted: encrypt(refresh),
      scope: token.scope,
      lastError: null,
    };
    const connection = existing
      ? await prisma.googleConnection.update({ where: { id: existing.id }, data: fields })
      : await prisma.googleConnection.create({
          data: { ...fields, userId, provider: 'MICROSOFT', googleSub: profile.id },
        });
    forgetMicrosoftAccessToken(connection.id);

    background(() => syncAccount(connection.id));
    return reply.redirect(`${back}?microsoft=ok`);
  });

  // Webhook das assinaturas do Graph. Na criação o Graph valida o endereço mandando um
  // validationToken, que precisa voltar como texto em até 10 s.
  app.post('/microsoft/webhook', async (request, reply) => {
    const { validationToken } = z
      .object({ validationToken: z.string().optional() })
      .parse(request.query);
    if (validationToken) return reply.type('text/plain').status(200).send(validationToken);

    const body = z
      .object({
        value: z.array(
          z.object({ subscriptionId: z.string(), clientState: z.string().optional() }).passthrough()
        ),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send();

    const toSync = new Set<string>();
    for (const notification of body.data.value) {
      const calendar = await prisma.googleCalendar.findUnique({
        where: { watchChannelId: notification.subscriptionId },
      });
      if (!calendar) continue;
      if (
        !notification.clientState ||
        !safeEqual(notification.clientState, channelToken(calendar.id))
      ) {
        return reply.status(403).send();
      }
      toSync.add(calendar.id);
    }
    for (const id of toSync) background(() => syncMicrosoftCalendar(id));
    return reply.status(202).send();
  });
}
