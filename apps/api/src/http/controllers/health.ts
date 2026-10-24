import type { HealthResponse } from '@jottape/schemas';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { prisma } from '@/lib/prisma';

// Healthcheck do Railway: 200 só com o banco respondendo, para um deploy sem banco não entrar no ar.
export async function health(_request: FastifyRequest, reply: FastifyReply) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const body: HealthResponse = { status: 'ok', database: 'ok' };
    return reply.status(200).send(body);
  } catch (_error) {
    const body: HealthResponse = { status: 'degraded', database: 'unavailable' };
    return reply.status(503).send(body);
  }
}
