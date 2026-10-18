import type { FastifyInstance } from 'fastify';

import { prisma } from '@/lib/prisma';
import { ensureOwner } from '@/services/owner';

export const OWNER = { email: 'andre@example.com', password: 'senha-forte-123', name: 'André' };

/** Esvazia todas as tabelas entre os testes (mais rápido que recriar o banco). */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`
  );
}

/** Cria o dono e devolve o cookie de sessão. */
export async function loginAsOwner(app: FastifyInstance) {
  const user = await ensureOwner(prisma, OWNER);
  const response = await app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { email: OWNER.email, password: OWNER.password },
  });
  const cookie = response.cookies.find((c) => c.name === 'jottape_session');
  if (!cookie) throw new Error(`login failed: ${response.statusCode} ${response.body}`);
  return { user, cookie: `jottape_session=${cookie.value}` };
}

/** app.inject já com o cookie. */
export function client(app: FastifyInstance, cookie: string) {
  const call =
    (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE') => (url: string, payload?: unknown) =>
      app.inject({
        method,
        url,
        headers: { cookie },
        ...(payload !== undefined ? { payload: payload as object } : {}),
      });
  return {
    get: call('GET'),
    post: call('POST'),
    patch: call('PATCH'),
    put: call('PUT'),
    delete: call('DELETE'),
  };
}
