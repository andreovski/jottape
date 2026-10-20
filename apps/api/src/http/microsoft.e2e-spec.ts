import type { EventOccurrence, GoogleStatusResponse } from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { app } from '@/app';
import { decrypt } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';
import { channelToken, syncAllCalendars } from '@/services/google/calendar';
import { forgetMicrosoftAccessToken } from '@/services/microsoft/client';
import { FakeGoogle } from '@/test/fake-google';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

describe('Microsoft (Outlook)', () => {
  let google: FakeGoogle;
  let api: ReturnType<typeof client>;
  let cookie: string;
  let userId: string;
  const range = '/events?from=2026-10-18T00:00:00Z&to=2026-12-31T00:00:00Z';

  beforeAll(() => app.ready());
  afterAll(() => app.close());
  afterEach(() => google.uninstall());

  beforeEach(async () => {
    await resetDatabase();
    google = new FakeGoogle().install();
    const session = await loginAsOwner(app);
    cookie = session.cookie;
    api = client(app, cookie);
    userId = session.user.id;
  });

  async function connectMicrosoft() {
    const start = await app.inject({ method: 'GET', url: '/microsoft/auth', headers: { cookie } });
    expect(start.statusCode).toBe(302);
    const location = new URL(start.headers.location as string);
    expect(location.host).toBe('login.microsoftonline.com');
    expect(location.searchParams.get('scope')).toContain('Calendars.ReadWrite');
    const state = location.searchParams.get('state')!;
    const nonce = start.cookies.find((c) => c.name === 'jottape_oauth')!.value;
    return app.inject({
      method: 'GET',
      url: `/microsoft/callback?code=abc&state=${encodeURIComponent(state)}`,
      headers: { cookie: `${cookie}; jottape_oauth=${nonce}` },
    });
  }

  async function status() {
    return (await api.get('/google/status')).json() as GoogleStatusResponse;
  }

  it('conecta uma conta da Microsoft e importa o calendário principal', async () => {
    google.msEvents.set('ms-cal-1', [
      {
        id: 'o1',
        type: 'singleInstance',
        subject: 'Reunião no Teams',
        body: { content: 'pauta' },
        location: { displayName: 'Sala 2' },
        start: { dateTime: '2026-10-21T13:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-10-21T14:00:00.0000000', timeZone: 'UTC' },
      },
      {
        id: 'o2',
        type: 'singleInstance',
        isAllDay: true,
        subject: 'Viagem',
        start: { dateTime: '2026-10-25T00:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-10-27T00:00:00.0000000', timeZone: 'UTC' },
      },
    ]);

    const callback = await connectMicrosoft();
    expect(callback.headers.location).toContain('/ajustes/google?microsoft=ok');
    await syncAllCalendars(userId);

    const data = await status();
    expect(data.microsoftConfigured).toBe(true);
    expect(data.accounts.map((a) => [a.provider, a.email, a.syncTasks])).toEqual([
      ['MICROSOFT', 'andre@outlook.com', false],
    ]);
    // Sem conta Google, as tarefas ficam só no Jottape.
    expect(data.tasksAccountId).toBeNull();
    expect(data.calendars.map((c) => [c.name, c.color, c.selected])).toEqual([
      ['Calendário', '#ff8c00', true],
      ['Feriados no Brasil', null, false],
    ]);
    expect(data.defaultCalendarId).toBe(data.calendars[0].id);

    const list: EventOccurrence[] = (await api.get(range)).json();
    expect(list.map((o) => [o.title, o.startAt, o.allDay, o.source])).toEqual([
      ['Reunião no Teams', '2026-10-21T13:00:00.000Z', false, 'MICROSOFT'],
      ['Viagem', '2026-10-25T00:00:00.000Z', true, 'MICROSOFT'],
    ]);
    expect(list[0]).toMatchObject({ description: 'pauta', location: 'Sala 2' });
  });

  it('delta traz criação, edição e remoção; guarda o refresh token novo', async () => {
    await connectMicrosoft();
    await syncAllCalendars(userId);

    google.msChange('ms-cal-1', {
      id: 'n1',
      type: 'occurrence',
      seriesMasterId: 's1',
      subject: 'Inglês',
      start: { dateTime: '2026-10-22T22:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-10-22T23:00:00.0000000', timeZone: 'UTC' },
    });
    google.msChange('ms-cal-1', {
      id: 'n2',
      type: 'singleInstance',
      subject: 'Dentista',
      start: { dateTime: '2026-10-23T12:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-10-23T13:00:00.0000000', timeZone: 'UTC' },
    });
    await syncAllCalendars(userId);
    let list: EventOccurrence[] = (await api.get(range)).json();
    expect(list.map((o) => o.title)).toEqual(['Inglês', 'Dentista']);

    google.msChange('ms-cal-1', { id: 'n2', subject: 'Dentista (remarcado)' });
    google.msChange('ms-cal-1', { id: 'n1', '@removed': { reason: 'deleted' } });
    await syncAllCalendars(userId);
    list = (await api.get(range)).json();
    expect(list.map((o) => o.title)).toEqual(['Dentista (remarcado)']);

    // Token de delta perdido: recomeça do zero sem duplicar.
    google.msDeltaGone = true;
    await syncAllCalendars(userId);
    expect(await prisma.event.count()).toBe(1);

    // A cada renovação a Microsoft manda outro refresh token, e o antigo deixa de valer.
    const connection = await prisma.googleConnection.findFirstOrThrow();
    expect(google.msRefreshTokens.has(decrypt(connection.refreshTokenEncrypted))).toBe(true);
    forgetMicrosoftAccessToken(connection.id);
    await syncAllCalendars(userId);
    expect((await status()).accounts[0].lastError).toBeNull();
  });

  it('eventos criados, editados e apagados no Jottape vão para o Outlook', async () => {
    await connectMicrosoft();
    await syncAllCalendars(userId);
    const calendarId = (await status()).calendars[0].id;

    const created = (
      await api.post('/events', {
        title: 'Almoço',
        startAt: '2026-10-24T15:00:00.000Z',
        endAt: '2026-10-24T16:00:00.000Z',
        calendarId,
      })
    ).json();
    expect(created).toMatchObject({ syncState: 'SYNCED', source: 'MICROSOFT' });
    const post = google.calls.find((c) => c.method === 'POST' && c.url.endsWith('/events'))!;
    expect(post.body).toMatchObject({
      subject: 'Almoço',
      isAllDay: false,
      start: { dateTime: '2026-10-24T12:00:00', timeZone: 'America/Sao_Paulo' },
    });

    await api.patch(`/events/${created.id}`, { title: 'Almoço com a equipe' });
    expect(google.msEvents.get('ms-cal-1')!.some((e) => e.subject === 'Almoço com a equipe')).toBe(
      true
    );

    // A volta do delta não duplica o evento.
    await syncAllCalendars(userId);
    expect(await prisma.event.count()).toBe(1);

    // Repetição de evento do Outlook não se muda pelo Jottape.
    const repeat = await api.patch(`/events/${created.id}`, { rrule: 'FREQ=DAILY' });
    expect(repeat.statusCode).toBe(400);

    await api.delete(`/events/${created.id}`);
    expect(google.msEvents.get('ms-cal-1')).toHaveLength(0);
    expect(await prisma.event.count()).toBe(0);
  });

  it('série nova vira série no Outlook e volta como ocorrências, com os alertas', async () => {
    await connectMicrosoft();
    await syncAllCalendars(userId);
    const calendarId = (await status()).calendars[0].id;

    const created = (
      await api.post('/events', {
        title: 'Corrida',
        startAt: '2026-10-20T09:00:00.000Z',
        endAt: '2026-10-20T10:00:00.000Z',
        rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3',
        reminders: [15],
        calendarId,
      })
    ).json();

    const post = google.calls.find((c) => c.method === 'POST' && c.url.endsWith('/events'))!;
    expect(post.body.recurrence).toEqual({
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
      range: {
        type: 'numbered',
        startDate: '2026-10-20',
        numberOfOccurrences: 3,
        recurrenceTimeZone: 'America/Sao_Paulo',
      },
    });

    // O mestre local saiu; ficaram as três ocorrências do Outlook, cada uma com o alerta.
    const events = await prisma.event.findMany({ orderBy: { startAt: 'asc' } });
    expect(events.map((e) => [e.title, e.rrule, e.source])).toEqual([
      ['Corrida', null, 'MICROSOFT'],
      ['Corrida', null, 'MICROSOFT'],
      ['Corrida', null, 'MICROSOFT'],
    ]);
    expect(created.id).toBe(events[0].id);
    expect(
      await prisma.reminder.count({ where: { ownerId: { in: events.map((e) => e.id) } } })
    ).toBe(3);
  });

  it('webhook responde à validação e confere o clientState', async () => {
    await connectMicrosoft();
    await syncAllCalendars(userId);
    const calendar = await prisma.googleCalendar.findFirstOrThrow({ where: { primary: true } });
    await prisma.googleCalendar.update({
      where: { id: calendar.id },
      data: { watchChannelId: 'sub-1' },
    });

    const validation = await app.inject({
      method: 'POST',
      url: '/microsoft/webhook?validationToken=abc%20123',
    });
    expect(validation.statusCode).toBe(200);
    expect(validation.body).toBe('abc 123');

    const bad = await app.inject({
      method: 'POST',
      url: '/microsoft/webhook',
      payload: { value: [{ subscriptionId: 'sub-1', clientState: 'errado' }] },
    });
    expect(bad.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST',
      url: '/microsoft/webhook',
      payload: { value: [{ subscriptionId: 'sub-1', clientState: channelToken(calendar.id) }] },
    });
    expect(ok.statusCode).toBe(202);
  });

  it('desconectar a conta da Microsoft apaga os eventos dela e não mexe no Google', async () => {
    await connectMicrosoft();
    google.msEvents.set('ms-cal-1', [
      {
        id: 'o1',
        type: 'singleInstance',
        subject: 'Do Outlook',
        start: { dateTime: '2026-10-21T13:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-10-21T14:00:00.0000000', timeZone: 'UTC' },
      },
    ]);
    await syncAllCalendars(userId);
    const account = (await status()).accounts[0];

    // Conta da Microsoft não pode ser a das tarefas.
    expect((await api.put('/google/tasks-account', { accountId: account.id })).statusCode).toBe(
      404
    );

    expect((await api.delete(`/google/accounts/${account.id}`)).statusCode).toBe(204);
    expect(await prisma.event.count()).toBe(0);
    expect((await status()).connected).toBe(false);
    expect(google.calls.some((c) => c.url.includes('oauth2.googleapis.com/revoke'))).toBe(false);
  });
});
