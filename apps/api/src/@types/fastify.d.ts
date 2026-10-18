import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido pelo hook `authenticate`. */
    userId: string;
  }
}
