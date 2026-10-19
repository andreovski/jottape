import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

const CODE = 'convite-de-teste';
const NEW_USER = {
  name: 'Maria',
  email: 'maria@example.com',
  password: 'outra-senha-forte',
  inviteCode: CODE,
  timezone: 'America/Manaus',
};

const register = (payload: object, remoteAddress?: string) =>
  app.inject({ method: 'POST', url: '/users', payload, remoteAddress });

const sessionOf = (response: Awaited<ReturnType<typeof register>>) => {
  const cookie = response.cookies.find((c) => c.name === 'jottape_session');
  if (!cookie) throw new Error(`sem sessão: ${response.statusCode} ${response.body}`);
  return `jottape_session=${cookie.value}`;
};

describe('cadastro', () => {
  beforeAll(() => app.ready());
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDatabase();
    process.env.SIGNUP_CODE = CODE;
  });
  afterEach(() => {
    delete process.env.SIGNUP_CODE;
  });

  it('cria a conta com categorias e a caixa de entrada e já entra', async () => {
    const response = await register(NEW_USER);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: 'Maria',
      email: NEW_USER.email,
      hasPassword: true,
      timezone: 'America/Manaus',
    });

    const api = client(app, sessionOf(response));
    expect((await api.get('/me')).json()).toMatchObject({ email: NEW_USER.email });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: NEW_USER.email } });
    expect(await prisma.category.count({ where: { userId: user.id } })).toBe(11);
    expect(await prisma.taskList.count({ where: { userId: user.id, isInbox: true } })).toBe(1);

    const login = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { email: NEW_USER.email, password: NEW_USER.password },
    });
    expect(login.statusCode).toBe(200);
  });

  it('não vê os dados de outro usuário', async () => {
    const owner = client(app, (await loginAsOwner(app)).cookie);
    const created = await owner.post('/accounts', {
      name: 'Conta do dono',
      type: 'CHECKING',
      initialBalanceCents: 1000,
      color: null,
    });
    expect(created.statusCode).toBe(201);

    const maria = client(app, sessionOf(await register(NEW_USER)));
    expect((await maria.get('/accounts')).json()).toEqual([]);
    expect(
      (await maria.patch(`/accounts/${created.json().id}`, { name: 'Minha' })).statusCode
    ).toBe(404);
    expect((await maria.delete(`/accounts/${created.json().id}`)).statusCode).toBe(404);
  });

  it('recusa sem o convite certo, com o cadastro fechado e com e-mail repetido', async () => {
    expect((await register({ ...NEW_USER, inviteCode: 'errado' })).statusCode).toBe(403);

    delete process.env.SIGNUP_CODE;
    const closed = await register(NEW_USER);
    expect(closed.statusCode).toBe(403);
    expect(closed.json().message).toBe('O cadastro está fechado.');
    process.env.SIGNUP_CODE = CODE;

    expect((await register(NEW_USER)).statusCode).toBe(201);
    const again = await register({ ...NEW_USER, email: 'MARIA@example.com' });
    expect(again.statusCode).toBe(409);
    expect(await prisma.user.count()).toBe(1);
  });

  it('bloqueia depois de 5 convites errados do mesmo IP', async () => {
    for (let i = 0; i < 5; i++) {
      expect(
        (await register({ ...NEW_USER, inviteCode: 'errado' }, '198.51.100.9')).statusCode
      ).toBe(403);
    }
    expect((await register(NEW_USER, '198.51.100.9')).statusCode).toBe(429);
  });

  it('valida a senha e o e-mail', async () => {
    expect((await register({ ...NEW_USER, password: 'curta' })).statusCode).toBe(400);
    expect((await register({ ...NEW_USER, email: 'não-é-email' })).statusCode).toBe(400);
  });
});
