import type { AgendaResponse, EventOccurrence } from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

const NOW = new Date('2026-10-18T15:00:00Z');

describe('agenda', () => {
  let api: ReturnType<typeof client>;

  beforeAll(() => app.ready());
  afterAll(() => app.close());
  afterEach(() => vi.useRealTimers());

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    await resetDatabase();
    api = client(app, (await loginAsOwner(app)).cookie);
  });

  const occurrences = async (from: string, to: string) =>
    (await api.get(`/events?from=${from}&to=${to}`)).json() as EventOccurrence[];

  it('cria evento com lembrete padrão e calcula o próximo disparo', async () => {
    const created = await api.post('/events', {
      title: 'Dentista',
      startAt: '2026-10-20T13:00:00.000Z',
      endAt: '2026-10-20T14:00:00.000Z',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ reminders: [10], source: 'LOCAL' });
    const reminder = await prisma.reminder.findFirstOrThrow();
    expect(reminder.nextFireAt?.toISOString()).toBe('2026-10-20T12:50:00.000Z');

    expect(
      (
        await api.post('/events', {
          title: 'x',
          startAt: '2026-10-20T13:00:00Z',
          endAt: '2026-10-20T12:00:00Z',
        })
      ).statusCode
    ).toBe(400);
  });

  it('recorrente: expande, edita uma ocorrência, cancela outra e edita a série', async () => {
    // Toda segunda às 9h de São Paulo (12:00 UTC).
    const event = (
      await api.post('/events', {
        title: 'Academia',
        startAt: '2026-10-19T12:00:00.000Z',
        endAt: '2026-10-19T13:00:00.000Z',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        reminders: [],
      })
    ).json();

    let list = await occurrences('2026-10-18T00:00:00Z', '2026-11-10T00:00:00Z');
    expect(list.map((o) => o.startAt)).toEqual([
      '2026-10-19T12:00:00.000Z',
      '2026-10-26T12:00:00.000Z',
      '2026-11-02T12:00:00.000Z',
      '2026-11-09T12:00:00.000Z',
    ]);

    await api.patch(`/events/${event.id}`, {
      scope: 'single',
      occurrenceStart: '2026-10-26T12:00:00.000Z',
      startAt: '2026-10-26T22:00:00.000Z',
      endAt: '2026-10-26T23:00:00.000Z',
      title: 'Academia (noite)',
    });
    await api.delete(`/events/${event.id}?scope=single&occurrenceStart=2026-11-02T12:00:00.000Z`);

    list = await occurrences('2026-10-18T00:00:00Z', '2026-11-10T00:00:00Z');
    expect(list.map((o) => [o.startAt, o.title, o.isException])).toEqual([
      ['2026-10-19T12:00:00.000Z', 'Academia', false],
      ['2026-10-26T22:00:00.000Z', 'Academia (noite)', true],
      ['2026-11-09T12:00:00.000Z', 'Academia', false],
    ]);
    expect(list[1].eventId).toBe(event.id);

    await api.patch(`/events/${event.id}`, { title: 'Treino' });
    list = await occurrences('2026-10-18T00:00:00Z', '2026-11-10T00:00:00Z');
    expect(list.map((o) => o.title)).toEqual(['Treino', 'Academia (noite)', 'Treino']);

    expect((await api.delete(`/events/${event.id}`)).statusCode).toBe(204);
    expect(await prisma.event.count()).toBe(0);
  });

  it('dia inteiro guarda o dia sem hora', async () => {
    const event = (
      await api.post('/events', {
        title: 'Feriado',
        startAt: '2026-11-02T10:00:00.000Z',
        endAt: '2026-11-02T10:00:00.000Z',
        allDay: true,
      })
    ).json();
    expect(event).toMatchObject({
      startAt: '2026-11-02T00:00:00.000Z',
      endAt: '2026-11-03T00:00:00.000Z',
      reminders: [],
    });
  });

  it('a agenda junta compromissos, tarefas, contas e faturas', async () => {
    const checking = (await api.post('/accounts', { name: 'Conta', type: 'CHECKING' })).json();
    const card = (
      await api.post('/accounts', {
        name: 'Cartão',
        type: 'CREDIT_CARD',
        closingDay: 10,
        dueDay: 20,
        paymentAccountId: checking.id,
      })
    ).json();
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 100_00,
      date: '2026-10-15',
      accountId: card.id,
      description: 'Compra',
    });
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 80_00,
      date: '2026-10-19',
      accountId: checking.id,
      description: 'Luz',
    });
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 30_00,
      date: '2026-10-16',
      accountId: checking.id,
      description: 'Água',
      status: 'PLANNED',
    });
    await api.post('/events', {
      title: 'Reunião',
      startAt: '2026-10-19T14:00:00Z',
      endAt: '2026-10-19T15:00:00Z',
    });
    await api.post('/tasks', { title: 'Pagar luz', dueAt: '2026-10-19T03:00:00.000Z' });
    await api.post('/tasks', { title: 'Atrasada', dueAt: '2026-10-10T03:00:00.000Z' });

    // Hoje e amanhã (fuso de São Paulo).
    const agenda: AgendaResponse = (
      await api.get('/agenda?from=2026-10-18T03:00:00.000Z&to=2026-10-20T03:00:00.000Z')
    ).json();
    expect(agenda.events.map((e) => e.title)).toEqual(['Reunião']);
    expect(agenda.tasks.map((t) => t.title).sort()).toEqual(['Atrasada', 'Pagar luz']);
    expect(agenda.bills.map((b) => b.description).sort()).toEqual(['Luz', 'Água']);
    expect(agenda.invoices).toEqual([]);

    const november: AgendaResponse = (
      await api.get('/agenda?from=2026-11-15T03:00:00.000Z&to=2026-11-25T03:00:00.000Z')
    ).json();
    expect(november.invoices).toMatchObject([
      { accountName: 'Cartão', dueDate: '2026-11-20', totalCents: 100_00 },
    ]);
    expect(november.tasks).toEqual([]);
  });
});
