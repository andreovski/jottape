import type { FastifyReply, FastifyRequest } from 'fastify';

import { isSecureCookie } from '@/lib/env';

export const SESSION_COOKIE = 'jottape_session';
const SESSION_DAYS = 30;

export async function startSession(reply: FastifyReply, userId: string) {
  const token = await reply.jwtSign({ sub: userId }, { expiresIn: `${SESSION_DAYS}d` });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookie(),
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function endSession(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Id do usuário da sessão, ou null. Não responde nada: quem decide é quem chama. */
export async function sessionUserId(request: FastifyRequest): Promise<string | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = request.server.jwt.verify<{ sub?: unknown }>(token);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** preHandler das rotas privadas. */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const userId = await sessionUserId(request);
  if (!userId) {
    return reply.status(401).send({ message: 'Unauthorized.' });
  }
  request.userId = userId;
}
