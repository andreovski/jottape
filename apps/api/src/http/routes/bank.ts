import {
  acceptBankMovementBodySchema,
  addBankItemBodySchema,
  bankMovementStatusSchema,
  linkBankAccountBodySchema,
  saveBankCredentialsBodySchema,
} from '@jottape/schemas';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  acceptAll,
  acceptMovement,
  acceptNotice,
  addItem,
  bankStatus,
  connectToken,
  ignoreMovement,
  linkAccount,
  listMovements,
  removeCredentials,
  removeItem,
  saveCredentials,
  syncUser,
} from '@/services/bank';

import { authenticate } from '../session';

const idParams = z.object({ id: z.string().uuid() });

// Bancos pelo Meu Pluggy, com as chaves da Pluggy de cada usuário (aberto a todos, sem custo).
export async function bankRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/bank', async (request) => bankStatus(request.userId));

  app.post('/bank/notice', async (request) => acceptNotice(request.userId));

  app.put('/bank/credentials', async (request) => {
    const body = saveBankCredentialsBodySchema.parse(request.body);
    return saveCredentials(request.userId, body);
  });

  app.delete('/bank/credentials', async (request, reply) => {
    await removeCredentials(request.userId);
    return reply.status(204).send();
  });

  app.post('/bank/connect-token', async (request) => connectToken(request.userId));

  app.post('/bank/items', async (request) => {
    const { itemId } = addBankItemBodySchema.parse(request.body);
    return addItem(request.userId, itemId);
  });

  app.delete('/bank/items/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await removeItem(request.userId, id);
    return reply.status(204).send();
  });

  app.patch('/bank/accounts/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return linkAccount(request.userId, id, linkBankAccountBodySchema.parse(request.body));
  });

  app.post('/bank/sync', async (request) => {
    await syncUser(request.userId);
    return bankStatus(request.userId);
  });

  // ------------------------------------------------------------ revisão

  app.get('/bank/movements', async (request) => {
    const { status } = z
      .object({ status: bankMovementStatusSchema.default('PENDING') })
      .parse(request.query);
    return listMovements(request.userId, status);
  });

  app.post('/bank/movements/accept-all', async (request) => acceptAll(request.userId));

  app.post('/bank/movements/:id/accept', async (request) => {
    const { id } = idParams.parse(request.params);
    return acceptMovement(
      request.userId,
      id,
      acceptBankMovementBodySchema.parse(request.body ?? {})
    );
  });

  app.post('/bank/movements/:id/ignore', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await ignoreMovement(request.userId, id);
    return reply.status(204).send();
  });
}
