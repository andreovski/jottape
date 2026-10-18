import type { EventOccurrence, GoogleStatusResponse, TaskResponse } from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { channelToken, syncAllCalendars } from '@/services/google/calendar';
import { forgetAccessToken } from '@/services/google/client';
import { syncTasks } from '@/services/google/tasks';
import { FakeGoogle } from '@/test/fake-google';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

describe('Google', () => {
  let google: FakeGoogle;
  let api: ReturnType<typeof client>;
  let userId: string;

  beforeAll(() => app.ready());
  afterAll(() => app.close());
  afterEach(() => google.uninstall());

  beforeEach(async () => {
    await resetDatabase();
    google = new FakeGoogle().install();
    const session = await loginAsOwner(app);
    api = client(app, session.cookie);
    userId = session.user.id;
    forgetAccessToken(userId);
  });

  /** Faz o fluxo de OAuth: /google/auth dá o state e o cookie, o callback grava a conexão. */
  async function connect(cookie: string, intent: 'connect' | 'login' = 'connect') {
    const start = await app.inject({
      method: 'GET',
      url: `/google/auth?intent=${intent}`,
      headers: { cookie },
    });
    expect(start.statusCode).toBe(302);
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const nonce = start.cookies.find((c) => c.name === 'jottape_oauth')!.value;
    return app.inject({
      method: 'GET',
      url: `/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      headers: { cookie: `${cookie}; jottape_oauth=${nonce}` },
    });
  }

  it('conecta, guarda o refresh token cifrado e liga a conta Google ao dono', async () => {
    const session = await loginAsOwner(app);
    const callback = await connect(session.cookie);
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toContain('/ajustes?google=ok');

    const connection = await prisma.googleConnection.findUniqueOrThrow({ where: { userId } });
    expect(connection.refreshTokenEncrypted).not.toContain('refresh-123');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).googleSub).toBe(
      'google-sub-1'
    );

    const status: GoogleStatusResponse = (await api.get('/google/status')).json();
    expect(status).toMatchObject({ configured: true, connected: true, email: 'andre@example.com' });
  });

  it('login com Google entra só com a conta do dono', async () => {
    const ok = await connect('', 'login');
    expect(ok.headers.location).toMatch(/\/$/);
    expect(ok.cookies.find((c) => c.name === 'jottape_session')?.value).toBeTruthy();

    await prisma.user.update({
      where: { id: userId },
      data: { email: 'outro@example.com', googleSub: null },
    });
    const denied = await connect('', 'login');
    expect(denied.headers.location).toContain('/entrar?erro=conta');
  });

  it('callback sem o cookie do state é recusado', async () => {
    const session = await loginAsOwner(app);
    const start = await app.inject({
      method: 'GET',
      url: '/google/auth?intent=connect',
      headers: { cookie: session.cookie },
    });
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const response = await app.inject({
      method: 'GET',
      url: `/google/callback?code=abc&state=${encodeURIComponent(state)}`,
    });
    expect(response.headers.location).toContain('erro=google');
    expect(await prisma.googleConnection.count()).toBe(0);
  });

  it('sincroniza o Calendar: importa série com exceção, envia evento local e refaz sync quando o token expira', async () => {
    await connect((await loginAsOwner(app)).cookie);
    google.events.set('primary@gmail.com', [
      {
        id: 'series',
        status: 'confirmed',
        summary: 'Inglês',
        start: { dateTime: '2026-10-20T22:00:00Z' },
        end: { dateTime: '2026-10-20T23:00:00Z' },
        recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'],
      },
      {
        id: 'series_20261027T220000Z',
        status: 'cancelled',
        recurringEventId: 'series',
        originalStartTime: { dateTime: '2026-10-27T22:00:00Z' },
      },
      { id: 'gone', status: 'cancelled' },
    ]);
    google.events.set('family@group', [
      {
        id: 'family-1',
        summary: 'Aniversário',
        start: { date: '2026-10-25' },
        end: { date: '2026-10-26' },
      },
    ]);

    await syncAllCalendars(userId);

    const status: GoogleStatusResponse = (await api.get('/google/status')).json();
    expect(status.calendars.map((c) => [c.name, c.selected])).toEqual([
      ['André', true],
      ['Família', false],
    ]);
    expect(status.defaultCalendarId).toBe(status.calendars[0].id);

    let list: EventOccurrence[] = (
      await api.get('/events?from=2026-10-18T00:00:00Z&to=2026-11-10T00:00:00Z')
    ).json();
    expect(list.map((o) => [o.title, o.startAt, o.source])).toEqual([
      ['Inglês', '2026-10-20T22:00:00.000Z', 'GOOGLE'],
      ['Inglês', '2026-11-03T22:00:00.000Z', 'GOOGLE'],
    ]);

    // Liga o calendário da família: aparece o evento de dia inteiro.
    await api.put('/google/calendars', {
      selectedIds: status.calendars.map((c) => c.id),
      defaultCalendarId: status.calendars[0].id,
    });
    await syncAllCalendars(userId);
    list = (await api.get('/events?from=2026-10-18T00:00:00Z&to=2026-11-10T00:00:00Z')).json();
    expect(list.find((o) => o.title === 'Aniversário')).toMatchObject({
      allDay: true,
      startAt: '2026-10-25T00:00:00.000Z',
    });

    // Evento criado no Jottape vai para o Google na hora.
    const created = (
      await api.post('/events', {
        title: 'Médico',
        startAt: '2026-10-22T13:00:00Z',
        endAt: '2026-10-22T14:00:00Z',
        calendarId: status.calendars[0].id,
      })
    ).json();
    expect(created.syncState).toBe('SYNCED');
    const pushed = google.events.get('primary@gmail.com')!.find((e) => e.summary === 'Médico');
    expect(pushed.start).toEqual({
      dateTime: '2026-10-22T13:00:00.000Z',
      timeZone: 'America/Sao_Paulo',
    });

    // Cancelar uma ocorrência da série do Google vira PATCH na instância.
    const series = list.find((o) => o.title === 'Inglês')!;
    await api.delete(
      `/events/${series.eventId}?scope=single&occurrenceStart=2026-11-03T22:00:00.000Z`
    );
    expect(
      google.calls.some(
        (c) =>
          c.method === 'PATCH' &&
          c.url.includes('series_20261103T220000Z') &&
          c.body.status === 'cancelled'
      )
    ).toBe(true);

    // Token de sync expirado: recomeça do zero sem duplicar.
    google.syncTokenGone = true;
    await syncAllCalendars(userId);
    expect(await prisma.event.count({ where: { title: 'Inglês', recurringEventId: null } })).toBe(
      1
    );

    // Apagar o evento local apaga no Google.
    await api.delete(`/events/${created.id}`);
    expect(google.events.get('primary@gmail.com')!.some((e) => e.summary === 'Médico')).toBe(false);
  });

  it('webhook confere o token do canal', async () => {
    await connect((await loginAsOwner(app)).cookie);
    await syncAllCalendars(userId);
    const calendar = await prisma.googleCalendar.findFirstOrThrow({ where: { primary: true } });
    await prisma.googleCalendar.update({
      where: { id: calendar.id },
      data: { watchChannelId: 'chan-1' },
    });

    const bad = await app.inject({
      method: 'POST',
      url: '/google/webhook',
      headers: {
        'x-goog-channel-id': 'chan-1',
        'x-goog-channel-token': 'errado',
        'x-goog-resource-state': 'exists',
      },
    });
    expect(bad.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST',
      url: '/google/webhook',
      headers: {
        'x-goog-channel-id': 'chan-1',
        'x-goog-channel-token': channelToken('chan-1'),
        'x-goog-resource-state': 'exists',
      },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('sincroniza o Google Tasks nos dois sentidos', async () => {
    // Tarefa local de antes de conectar sobe na primeira sincronização.
    const local = (
      await api.post('/tasks', { title: 'Ligar para o banco', dueAt: '2026-10-20T03:00:00.000Z' })
    ).json();
    await connect((await loginAsOwner(app)).cookie);

    google.tasks.set('shopping', [
      { id: 'milk', title: 'Leite', status: 'needsAction', due: '2026-10-19T00:00:00.000Z' },
      { id: 'eggs', title: 'Ovos', status: 'completed', completed: '2026-10-17T10:00:00.000Z' },
      { id: 'brand', title: 'Integral', status: 'needsAction', parent: 'milk' },
    ]);

    await syncTasks(userId);

    // Caixa de entrada = lista padrão do Google; a tarefa local foi enviada.
    const sent = google.tasks.get('default-list')!.find((t) => t.title === 'Ligar para o banco');
    expect(sent).toMatchObject({ due: '2026-10-20T00:00:00.000Z', status: 'needsAction' });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: local.id } })).googleTaskId).toBe(
      sent.id
    );

    const lists = (await api.get('/task-lists')).json();
    const shopping = lists.find((l: { name: string }) => l.name === 'Compras');
    expect(shopping.googleLinked).toBe(true);

    const open: TaskResponse[] = (await api.get(`/tasks?listId=${shopping.id}`)).json();
    expect(open.map((t) => [t.title, t.dueAt, t.subtasks.map((s) => s.title)])).toEqual([
      ['Leite', '2026-10-19T03:00:00.000Z', ['Integral']],
    ]);

    // Concluir no Jottape conclui no Google.
    const milk = open[0];
    await api.post(`/tasks/${milk.id}/complete`);
    expect(google.tasks.get('shopping')!.find((t) => t.id === 'milk')).toMatchObject({
      status: 'completed',
    });

    // Lista nova no Jottape vira lista no Google.
    await api.post('/task-lists', { name: 'Trabalho' });
    await syncTasks(userId);
    expect(google.taskLists.some((l) => l.title === 'Trabalho')).toBe(true);

    // Apagada no Google: some no Jottape na próxima sincronização.
    google.tasks.get('shopping')!.find((t) => t.id === 'brand').deleted = true;
    await syncTasks(userId);
    expect(await prisma.task.count({ where: { googleTaskId: 'brand' } })).toBe(0);

    // Apagar no Jottape apaga no Google.
    await api.delete(`/tasks/${local.id}`);
    expect(google.tasks.get('default-list')!.some((t) => t.title === 'Ligar para o banco')).toBe(
      false
    );
    expect(await prisma.task.count({ where: { id: local.id } })).toBe(0);
  });

  it('desconectar remove os eventos do Google e mantém as tarefas', async () => {
    await connect((await loginAsOwner(app)).cookie);
    google.events.set('primary@gmail.com', [
      {
        id: 'x',
        summary: 'Do Google',
        start: { dateTime: '2026-10-20T10:00:00Z' },
        end: { dateTime: '2026-10-20T11:00:00Z' },
      },
    ]);
    google.tasks.set('default-list', [
      { id: 'a', title: 'Do Google Tasks', status: 'needsAction' },
    ]);
    await syncAllCalendars(userId);
    await syncTasks(userId);

    expect((await api.delete('/google')).statusCode).toBe(204);
    expect(await prisma.event.count()).toBe(0);
    expect(
      await prisma.task.count({ where: { title: 'Do Google Tasks', googleTaskId: null } })
    ).toBe(1);
    expect(((await api.get('/google/status')).json() as GoogleStatusResponse).connected).toBe(
      false
    );
  });
});
