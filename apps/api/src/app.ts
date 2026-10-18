import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastify from 'fastify';
import { ZodError } from 'zod';

import { appRoutes } from './http/routes';
import { getAllowedOrigins, getJwtSecret } from './lib/env';
import { AppError } from './lib/errors';

// Atrás do proxy do Railway, request.ip e o protocolo são os do proxy sem isto.
export const app = fastify({ trustProxy: process.env.TRUST_PROXY === 'true' });

app.register(cookie);

app.register(cors, {
  origin: getAllowedOrigins(),
  credentials: true,
  exposedHeaders: ['Content-Disposition'],
});

app.register(jwt, { secret: getJwtSecret() });

app.decorateRequest('userId', '');

app.register(appRoutes);

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({ message: 'Validation error.', issues: error.format() });
  }

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ message: error.message });
  }

  // Erros do próprio Fastify causados pela requisição (JSON malformado, corpo grande demais).
  if (error.statusCode !== undefined && error.statusCode < 500) {
    return reply.status(error.statusCode).send({ message: 'Bad request.' });
  }

  console.error(`[api] ${request.method} ${request.routeOptions.url ?? 'unmatched route'}`, error);
  return reply.status(500).send({ message: 'Internal server error.' });
});
