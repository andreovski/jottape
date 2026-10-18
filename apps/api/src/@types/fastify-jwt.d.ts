import '@fastify/jwt';

declare module '@fastify/jwt' {
  export interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}
