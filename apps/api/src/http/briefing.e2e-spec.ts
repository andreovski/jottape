import type { BriefingResponse, BriefingSettings, NextEventResponse } from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

// Segunda, 19/10/2026, 10:00 em São Paulo.
const NOW = new Date('2026-10-19T13:00:00Z');

describe('briefing', () => {
  let api: ReturnType<typeof client>;
  let userId: string;

  beforeAll(() => app.ready());
  afterAll(() => app.close());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    await resetDatabase();
    const login = await loginAsOwner(app);
    userId = login.user.id;
    api = client(app, login.cookie);
  });

  const briefing = async () => (await api.get('/briefing')).json() as BriefingResponse;

  it('começa com o padrão e salva ordem, plugins e ajustes', async () => {
    const initial = (await api.get('/briefing/settings')).json() as BriefingSettings;
    expect(initial.plugins[0]).toEqual({ id: 'day', enabled: true });
    expect(initial.plugins.find((p) => p.id === 'horoscope')).toEqual({
      id: 'horoscope',
      enabled: false,
    });

    const saved = await api.put('/briefing/settings', {
      plugins: [
        { id: 'quote', enabled: true },
        { id: 'day', enabled: true },
      ],
      sign: 'leao',
      city: null,
      currencies: ['USD'],
    });
    expect(saved.statusCode).toBe(200);
    const body = saved.json() as BriefingSettings;
    // Os que não vieram entram desligados no fim.
    expect(body.plugins.slice(0, 3)).toEqual([
      { id: 'quote', enabled: true },
      { id: 'day', enabled: true },
      { id: 'free', enabled: false },
    ]);
    expect(body.sign).toBe('leao');

    const items = (await briefing()).items;
    expect(items.map((i) => i.plugin)).toEqual(['quote', 'day']);

    expect((await api.put('/briefing/settings', { ...body, sign: 'dragao' })).statusCode).toBe(400);
  });

  it('monta o dia com agenda, tarefas e contas', async () => {
    await api.post('/events', {
      title: 'Dentista',
      startAt: '2026-10-19T17:00:00.000Z',
      endAt: '2026-10-19T18:00:00.000Z',
      reminders: [],
    });
    await api.post('/tasks', { title: 'Pagar IPVA', dueAt: '2026-10-15T03:00:00.000Z' });
    const account = (
      await api.post('/accounts', { name: 'Conta', type: 'CHECKING', initialBalanceCents: 10000 })
    ).json();
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 50000,
      date: '2026-10-21',
      accountId: account.id,
      description: 'Aluguel',
    });

    const { date, items } = await briefing();
    expect(date).toBe('2026-10-19');
    const text = (plugin: string) => items.filter((i) => i.plugin === plugin).map((i) => i.text);

    expect(text('day')).toEqual([
      'Hoje: 1 compromisso, o primeiro às 14:00 (Dentista) e 1 tarefa (atrasada).',
    ]);
    expect(text('free')).toEqual(['Livre das 15:00 às 20:00.']);
    expect(text('bills')).toEqual(['Aluguel vence na quarta-feira: {0}.']);
    expect(items.find((i) => i.plugin === 'bills')?.values).toEqual([50000]);
    // 100 − 500 = −400 na quarta.
    expect(items.find((i) => i.plugin === 'balance')).toMatchObject({
      values: [-40000],
      tone: 'bad',
    });
    expect(text('stale')).toEqual(['“Pagar IPVA” está atrasada há 4 dias.']);
  });

  it('plugin de fora que falha só fica de fora', async () => {
    await prisma.briefingSettings.create({
      data: {
        userId,
        settings: {
          plugins: [
            { id: 'weather', enabled: true },
            { id: 'moon', enabled: true },
          ],
          sign: null,
          city: { name: 'Goiânia, Goiás, Brasil', latitude: -16.68, longitude: -49.25 },
          currencies: [],
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fora do ar')));
    expect((await briefing()).items.map((i) => i.plugin)).toEqual(['moon']);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            current: { temperature_2m: 27.2, weather_code: 0 },
            daily: {
              temperature_2m_max: [32.6],
              temperature_2m_min: [19.1],
              precipitation_probability_max: [70],
            },
          })
        )
      )
    );
    const weather = (await briefing()).items[0];
    expect(weather.text).toBe(
      'Goiânia: 27° agora, céu limpo. Máxima de 33° e mínima de 19°. Chance de chuva de 70%, leve guarda-chuva.'
    );
    // Guardado: a segunda leitura não chama o serviço de novo.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fora do ar')));
    expect((await briefing()).items[0].plugin).toBe('weather');
  });

  it('próximo compromisso depois de hoje', async () => {
    const from = '2026-10-20T03:00:00.000Z';
    const next = async () =>
      ((await api.get(`/events/next?from=${encodeURIComponent(from)}`)).json() as NextEventResponse)
        .event;
    expect(await next()).toBeNull();

    await api.post('/events', {
      title: 'Hoje',
      startAt: '2026-10-19T17:00:00.000Z',
      endAt: '2026-10-19T18:00:00.000Z',
      reminders: [],
    });
    await api.post('/events', {
      title: 'Viagem',
      startAt: '2026-11-30T12:00:00.000Z',
      endAt: '2026-11-30T13:00:00.000Z',
      reminders: [],
    });
    expect((await next())?.title).toBe('Viagem');

    await api.post('/events', {
      title: 'Feriado',
      allDay: true,
      startAt: '2026-11-02T00:00:00.000Z',
      endAt: '2026-11-03T00:00:00.000Z',
      reminders: [],
    });
    expect((await next())?.title).toBe('Feriado');
  });
});
