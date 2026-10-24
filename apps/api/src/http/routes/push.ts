import { pushSubscribeBodySchema, pushUnsubscribeBodySchema } from '@jottape/schemas';
import type { FastifyInstance } from 'fastify';

import { getVapidConfig } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { sendPush } from '@/services/push';

import { authenticate } from '../session';

export async function pushRoutes(app: FastifyInstance) {
  app.get('/push/public-key', async () => ({ publicKey: getVapidConfig()?.publicKey ?? null }));

  app.register(async (privateRoutes) => {
    privateRoutes.addHook('preHandler', authenticate);

    privateRoutes.post('/push/subscriptions', async (request, reply) => {
      const body = pushSubscribeBodySchema.parse(request.body);
      const userAgent = request.headers['user-agent']?.slice(0, 300) ?? null;
      await prisma.pushSubscription.upsert({
        where: { endpoint: body.endpoint },
        update: {
          userId: request.userId,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent,
        },
        create: {
          userId: request.userId,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent,
        },
      });
      return reply.status(201).send({ message: 'ok' });
    });

    privateRoutes.delete('/push/subscriptions', async (request, reply) => {
      const { endpoint } = pushUnsubscribeBodySchema.parse(request.body);
      await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: request.userId } });
      return reply.status(204).send();
    });

    privateRoutes.post('/push/test', async (request) => {
      const delivered = await sendPush(request.userId, {
        title: 'Jottape',
        body: 'As notificações estão funcionando.',
        url: '/ajustes',
        tag: 'test',
      });
      return { delivered };
    });
  });
}
