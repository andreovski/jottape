/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => [] as { endpoint: string; payload: any }[]);
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (subscription: { endpoint: string }, payload: string) => {
      if (subscription.endpoint.includes('expired'))
        throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    }),
  },
}));

import { app } from '@/app';
import { runDailySummaries, runReminders } from '@/jobs/reminders';
import { prisma } from '@/lib/prisma';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

describe('lembretes e notificações', () => {
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    process.env.VAPID_PUBLIC_KEY = 'public';
    process.env.VAPID_PRIVATE_KEY = 'private';
    await app.ready();
  });
  afterAll(() => app.close());
  afterEach(() => vi.useRealTimers());

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-18T15:00:00Z') });
    sent.length = 0;
    await resetDatabase();
    api = client(app, (await loginAsOwner(app)).cookie);
    await api.post('/push/subscriptions', {
      endpoint: 'https://push.example/ok',
      keys: { p256dh: 'k', auth: 'a' },
    });
    await api.post('/push/subscriptions', {
      endpoint: 'https://push.example/expired',
      keys: { p256dh: 'k', auth: 'a' },
    });
  });

  it('chave pública vem da configuração', async () => {
    expect((await app.inject({ method: 'GET', url: '/push/public-key' })).json()).toEqual({
      publicKey: 'public',
    });
  });

  it('dispara o lembrete de cada ocorrência uma vez e apaga a inscrição expirada', async () => {
    await api.post('/events', {
      title: 'Daily',
      startAt: '2026-10-19T12:00:00Z',
      endAt: '2026-10-19T12:15:00Z',
      rrule: 'FREQ=DAILY',
      reminders: [10],
    });

    vi.setSystemTime(new Date('2026-10-19T11:50:30Z'));
    expect(await runReminders()).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ title: 'Daily', url: '/agenda' });
    expect(sent[0].payload.body).toContain('09:00');
    expect(await prisma.pushSubscription.count()).toBe(1);

    expect(await runReminders()).toBe(0);
    const reminder = await prisma.reminder.findFirstOrThrow();
    expect(reminder.nextFireAt?.toISOString()).toBe('2026-10-20T11:50:00.000Z');
  });

  it('pula ocorrência cancelada e lembrete muito atrasado', async () => {
    const event = (
      await api.post('/events', {
        title: 'Aula',
        startAt: '2026-10-19T12:00:00Z',
        endAt: '2026-10-19T13:00:00Z',
        rrule: 'FREQ=DAILY',
        reminders: [0],
      })
    ).json();
    await api.delete(`/events/${event.id}?scope=single&occurrenceStart=2026-10-19T12:00:00.000Z`);

    vi.setSystemTime(new Date('2026-10-19T12:00:10Z'));
    await runReminders();
    expect(sent).toHaveLength(0);

    // Servidor fora do ar por 3 horas: não manda o atrasado, só agenda o próximo.
    vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));
    await runReminders();
    expect(sent).toHaveLength(0);
    const reminder = await prisma.reminder.findFirstOrThrow();
    expect(reminder.nextFireAt?.toISOString()).toBe('2026-10-21T12:00:00.000Z');
  });

  it('resumo do dia sai uma vez no horário escolhido', async () => {
    await api.post('/tasks', { title: 'Pagar boleto', dueAt: '2026-10-19T03:00:00.000Z' });
    await api.post('/events', {
      title: 'Reunião',
      startAt: '2026-10-19T14:00:00Z',
      endAt: '2026-10-19T15:00:00Z',
    });

    vi.setSystemTime(new Date('2026-10-19T10:30:00Z')); // 7h30 em São Paulo
    expect(await runDailySummaries()).toBe(0);
    vi.setSystemTime(new Date('2026-10-19T11:05:00Z')); // 8h05
    expect(await runDailySummaries()).toBe(1);
    expect(sent.at(-1)!.payload.body).toBe('1 compromisso · 1 tarefa. Primeiro: Reunião às 11:00');
    expect(await runDailySummaries()).toBe(0);
  });

  it('exporta os lançamentos em CSV para o Excel', async () => {
    const account = (await api.post('/accounts', { name: 'Conta', type: 'CHECKING' })).json();
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 12_34,
      date: '2026-10-18',
      accountId: account.id,
      description: 'Café; pão',
    });
    const csv = await api.get('/export?format=csv');
    expect(csv.headers['content-disposition']).toContain('jottape-lancamentos-2026-10-18.csv');
    expect(csv.body).toContain('2026-10-18;"Café; pão";Despesa;12,34;Conta;;;Efetivado;;');
    const json = (await api.get('/export')).json();
    expect(json.transactions).toHaveLength(1);
  });
});
