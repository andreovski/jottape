import {
  changePasswordBodySchema,
  loginBodySchema,
  type MeResponse,
  updateProfileBodySchema,
} from '@jottape/schemas';
import type { User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/services/owner';

import { authenticate, endSession, startSession } from '../session';

const MAX_FAILURES = 5;
// Teto somado de todos os IPs: o IP vem do X-Forwarded-For, que quem chama pode inventar. Com um
// usuário só, travar a senha por um tempo é aceitável (o login pelo Google continua).
const MAX_GLOBAL_FAILURES = 30;
const WINDOW_MS = 15 * 60_000;

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

export async function authRoutes(app: FastifyInstance) {
  app.post('/sessions', async (request, reply) => {
    const { email, password } = loginBodySchema.parse(request.body);
    const ip = request.ip;

    const since = new Date(Date.now() - WINDOW_MS);
    const [failures, globalFailures] = await Promise.all([
      prisma.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } }),
      prisma.loginAttempt.count({ where: { success: false, createdAt: { gte: since } } }),
    ]);
    if (failures >= MAX_FAILURES || globalFailures >= MAX_GLOBAL_FAILURES) {
      return reply
        .status(429)
        .send({ message: 'Muitas tentativas. Espere alguns minutos e tente de novo.' });
    }

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
