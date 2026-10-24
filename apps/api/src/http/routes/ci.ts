import { ciBenchmarkRunBodySchema } from '@jottape/schemas';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';

import { getBenchToken, getOwner } from '@/lib/env';
import { AppError, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { activeTestCases, recordRun } from '@/services/assistant/benchmark';

// Para o job da CI que roda o teste de acerto num PR: lê os casos reais e grava a rodada no
// histórico do painel. Entra com o BENCH_TOKEN, sem sessão; sem a variável, as rotas não existem.

function assertToken(request: FastifyRequest) {
  const token = getBenchToken();
  if (!token) throw notFound('Rota');
  const sent = Buffer.from((request.headers.authorization ?? '').replace(/^Bearer /, ''));
  const wanted = Buffer.from(token);
  if (sent.length !== wanted.length || !timingSafeEqual(sent, wanted)) {
    throw new AppError(401, 'Chave inválida.');
  }
}

export async function ciRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request) => assertToken(request));

  app.get('/ci/assistant/cases', async () => ({ testCases: await activeTestCases() }));

  app.post('/ci/assistant/runs', async (request, reply) => {
    const body = ciBenchmarkRunBodySchema.parse(request.body);
    const email = getOwner()?.email;
    const owner = email
      ? await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })
      : null;
    if (!owner) throw new AppError(409, 'Sem o dono do app para registrar o custo.');
    await recordRun(owner.id, body.result, body.usage, {
      source: 'CI',
      commit: body.commit,
      label: body.label,
      regressions: body.regressions,
    });
    return reply.status(204).send();
  });
}
