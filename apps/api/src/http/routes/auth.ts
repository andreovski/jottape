import {
  changePasswordBodySchema,
  loginBodySchema,
  type MeResponse,
  registerBodySchema,
  updateProfileBodySchema,
} from '@jottape/schemas';
import { Prisma, type User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

import { getSignupCode } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { ensureUserDefaults, hashPassword } from '@/services/owner';

import { authenticate, endSession, startSession } from '../session';

const MAX_FAILURES = 5;
// Teto somado de todos os IPs: o IP vem do X-Forwarded-For, que quem chama pode inventar. Com
// poucos usuários, travar a senha por um tempo é aceitável (o login pelo Google continua).
const MAX_GLOBAL_FAILURES = 30;
const WINDOW_MS = 15 * 60_000;
// Cadastros que dão certo, somando todos: segura um convite vazado.
const MAX_SIGNUPS_PER_HOUR = 5;

// Hash fixo para comparar quando o e-mail não existe: a resposta leva o mesmo tempo.
const DUMMY_HASH = '$2a$10$e2YTR9U7hSn8mkAQVgaAFu.xc80Zh97vvvHojGI6M1p0zc0qEco62';

export function toMe(user: User): MeResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    hasPassword: Boolean(user.passwordHash),
    googleLinked: Boolean(user.googleSub),
    timezone: user.timezone,
    currency: user.currency,
    weekStartsOn: user.weekStartsOn,
    defaultReminderMin: user.defaultReminderMin,
    dailySummaryHour: user.dailySummaryHour,
  };
}

/** Erros recentes (senha ou convite) deste IP e de todos: o login e o cadastro dividem o limite. */
async function tooManyFailures(request: FastifyRequest) {
  const since = new Date(Date.now() - WINDOW_MS);
  const [failures, globalFailures] = await Promise.all([
    prisma.loginAttempt.count({
      where: { ip: request.ip, success: false, createdAt: { gte: since } },
    }),
    prisma.loginAttempt.count({ where: { success: false, createdAt: { gte: since } } }),
  ]);
  return failures >= MAX_FAILURES || globalFailures >= MAX_GLOBAL_FAILURES;
}

const TOO_MANY = { message: 'Muitas tentativas. Espere alguns minutos e tente de novo.' };

function sameCode(given: string, expected: string) {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/users', async (request, reply) => {
    const body = registerBodySchema.parse(request.body);
    const expected = getSignupCode();
    if (!expected) throw new AppError(403, 'O cadastro está fechado.');

    if (await tooManyFailures(request)) return reply.status(429).send(TOO_MANY);
    if (!sameCode(body.inviteCode, expected)) {
      await prisma.loginAttempt.create({
        data: { email: `cadastro:${body.email}`, ip: request.ip, success: false },
      });
      throw new AppError(403, 'Código de convite incorreto.');
    }

    const recent = await prisma.user.count({
      where: { createdAt: { gte: new Date(Date.now() - 60 * 60_000) } },
    });
    if (recent >= MAX_SIGNUPS_PER_HOUR) return reply.status(429).send(TOO_MANY);

    if (await prisma.user.findUnique({ where: { email: body.email } })) {
      throw new AppError(409, 'Já existe uma conta com este e-mail. Entre com a sua senha.');
    }

    let timezone: string | undefined;
    try {
      if (body.timezone) new Intl.DateTimeFormat('en-US', { timeZone: body.timezone });
      timezone = body.timezone;
    } catch {
      timezone = undefined;
    }

    const passwordHash = await hashPassword(body.password);
    const user = await prisma
      .$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { name: body.name, email: body.email, passwordHash, timezone },
        });
        await ensureUserDefaults(tx, created.id);
        return created;
      })
      .catch((error: unknown) => {
        // Dois cadastros do mesmo e-mail ao mesmo tempo: o índice único segura o segundo.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new AppError(409, 'Já existe uma conta com este e-mail. Entre com a sua senha.');
        }
        throw error;
      });

    await startSession(reply, user.id);
    return reply.status(201).send(toMe(user));
  });

  app.post('/sessions', async (request, reply) => {
    const { email, password } = loginBodySchema.parse(request.body);
    const ip = request.ip;

    if (await tooManyFailures(request)) return reply.status(429).send(TOO_MANY);

    const user = await prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    const success = Boolean(user?.passwordHash) && ok;

    await prisma.loginAttempt.create({ data: { email, ip, success } });

    if (!success || !user) {
      return reply.status(401).send({ message: 'E-mail ou senha incorretos.' });
    }

    await startSession(reply, user.id);
    return toMe(user);
  });

  app.delete('/sessions', async (_request, reply) => {
    endSession(reply);
    return reply.status(204).send();
  });

  app.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) {
      endSession(reply);
      return reply.status(401).send({ message: 'Unauthorized.' });
    }
    return toMe(user);
  });

  app.patch('/me', { preHandler: authenticate }, async (request) => {
    const body = updateProfileBodySchema.parse(request.body);
    if (body.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: body.timezone });
      } catch {
        throw new AppError(400, 'Fuso horário inválido.');
      }
    }
    const user = await prisma.user.update({ where: { id: request.userId }, data: body });
    return toMe(user);
  });

  app.patch('/me/password', { preHandler: authenticate }, async (request, reply) => {
    const { currentPassword, newPassword } = changePasswordBodySchema.parse(request.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.userId } });

    if (user.passwordHash) {
      if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
        throw new AppError(400, 'Senha atual incorreta.');
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    return reply.status(204).send();
  });
}
