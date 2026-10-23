import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { ensureOwner } from '@/services/owner';
import { client, loginAsOwner, OWNER, resetDatabase } from '@/test/helpers';

describe('sessão e perfil', () => {
  beforeAll(() => app.ready());
  afterAll(() => app.close());
  beforeEach(resetDatabase);

  it('o seed é idempotente e cria categorias e a caixa de entrada', async () => {
    await ensureOwner(prisma, OWNER);
    await ensureOwner(prisma, { ...OWNER, password: 'outra-senha' });
    expect(await prisma.user.count()).toBe(1);
    // As 11 padrão e as 8 fixas (Transferência, Pix, Débito e Crédito em entradas e saídas).
    expect(await prisma.category.count()).toBe(19);
    expect(await prisma.taskList.count({ where: { isInbox: true } })).toBe(1);
  });

  it('entra com e-mail e senha e lê o perfil', async () => {
    const { cookie } = await loginAsOwner(app);
    const me = await client(app, cookie).get('/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: OWNER.email, hasPassword: true, googleLinked: false });
  });

  it('recusa senha errada e bloqueia depois de 5 tentativas', async () => {
    await ensureOwner(prisma, OWNER);
    for (let i = 0; i < 5; i++) {
      const wrong = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { email: OWNER.email, password: 'errada' },
      });
      expect(wrong.statusCode).toBe(401);
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { email: OWNER.email, password: OWNER.password },
    });
    expect(blocked.statusCode).toBe(429);
  });

  it('trava o login depois de 30 erros somando todos os IPs', async () => {
    await ensureOwner(prisma, OWNER);
    await prisma.loginAttempt.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        email: OWNER.email,
        ip: `203.0.113.${i}`,
        success: false,
      })),
    });
    const blocked = await app.inject({
      method: 'POST',
      url: '/sessions',
      remoteAddress: '198.51.100.7',
      payload: { email: OWNER.email, password: OWNER.password },
    });
    expect(blocked.statusCode).toBe(429);
  });

  it('sem sessão é 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/accounts' })).statusCode).toBe(401);
  });

  it('edita o perfil e troca a senha', async () => {
    const { cookie } = await loginAsOwner(app);
    const api = client(app, cookie);

    const updated = await api.patch('/me', { name: 'André L.', dailySummaryHour: 7 });
    expect(updated.json()).toMatchObject({ name: 'André L.', dailySummaryHour: 7 });
    expect((await api.patch('/me', { timezone: 'Lua/Base' })).statusCode).toBe(400);

    expect(
      (await api.patch('/me/password', { currentPassword: 'x', newPassword: 'nova-senha-1' }))
        .statusCode
    ).toBe(400);
    expect(
      (
        await api.patch('/me/password', {
          currentPassword: OWNER.password,
          newPassword: 'nova-senha-1',
        })
      ).statusCode
    ).toBe(204);

    const login = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { email: OWNER.email, password: 'nova-senha-1' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('sair apaga o cookie', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/sessions' });
    expect(response.statusCode).toBe(204);
    expect(response.cookies.find((c) => c.name === 'jottape_session')?.value).toBe('');
  });
});
