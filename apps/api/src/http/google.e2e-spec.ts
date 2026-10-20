import type { EventOccurrence, GoogleStatusResponse, TaskResponse } from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { channelToken, syncAllCalendars } from '@/services/google/calendar';
import { NOT_CALENDAR_USER_MESSAGE, RECONNECT_MESSAGE } from '@/services/google/client';
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

    const connection = await prisma.googleConnection.findFirstOrThrow({ where: { userId } });
    expect(connection).toMatchObject({ googleSub: 'google-sub-1', syncTasks: true });
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

  describe('várias contas', () => {
    const range = '/events?from=2026-10-18T00:00:00Z&to=2026-11-10T00:00:00Z';

    async function connectBoth() {
      const { cookie } = await loginAsOwner(app);
      await connect(cookie);
      google.nextAccount = 'google-sub-2';
      const second = await connect(cookie);
      expect(second.headers.location).toContain('/ajustes?google=ok');
      google.events.set('primary@gmail.com', [
        {
          id: 'p1',
          summary: 'Pessoal',
          start: { dateTime: '2026-10-20T10:00:00Z' },
          end: { dateTime: '2026-10-20T11:00:00Z' },
        },
      ]);
      google.events.set('work@company.com', [
        {
          id: 'w1',
          summary: 'Reunião',
          start: { dateTime: '2026-10-21T13:00:00Z' },
          end: { dateTime: '2026-10-21T14:00:00Z' },
        },
      ]);
      await syncAllCalendars(userId);
      return (await api.get('/google/status')).json() as GoogleStatusResponse;
    }

    it('conecta a segunda conta e junta as agendas; calendário repetido chega desmarcado', async () => {
      const status = await connectBoth();
      expect(status.accounts.map((a) => [a.email, a.syncTasks])).toEqual([
        ['andre@example.com', true],
        ['trabalho@example.com', false],
      ]);
      const [first, second] = status.accounts;
      expect(status.tasksAccountId).toBe(first.id);
      const [, family1, , family2] = status.calendars;
      expect(status.calendars.map((c) => [c.accountId, c.name, c.selected, c.alsoIn])).toEqual([
        [first.id, 'André', true, []],
        [first.id, 'Família', false, [family2.id]],
        [second.id, 'Trabalho', true, []],
        [second.id, 'Família', false, [family1.id]],
      ]);
      // O padrão continua o da primeira conta.
      expect(status.defaultCalendarId).toBe(status.calendars[0].id);

      const list: EventOccurrence[] = (await api.get(range)).json();
      expect(list.map((o) => o.title)).toEqual(['Pessoal', 'Reunião']);

      // Evento novo num calendário da segunda conta vai para ela.
      const work = status.calendars.find((c) => c.name === 'Trabalho')!;
      await api.post('/events', {
        title: 'Planejamento',
        startAt: '2026-10-22T13:00:00Z',
        endAt: '2026-10-22T14:00:00Z',
        calendarId: work.id,
      });
      expect(google.events.get('work@company.com')!.some((e) => e.summary === 'Planejamento')).toBe(
        true
      );
      expect(
        google.events.get('primary@gmail.com')!.some((e) => e.summary === 'Planejamento')
      ).toBe(false);

      // Cor própria no Jottape vence a do Google.
      const updated: GoogleStatusResponse = (
        await api.put('/google/calendars', {
          selectedIds: status.calendars.filter((c) => c.selected).map((c) => c.id),
          defaultCalendarId: work.id,
          colors: { [work.id]: '#af52de' },
        })
      ).json();
      expect(updated.calendars.find((c) => c.id === work.id)).toMatchObject({
        color: '#af52de',
        colorOverride: '#af52de',
      });
      expect(updated.defaultCalendarId).toBe(work.id);

      // Conectar de novo a mesma conta só renova o token.
      const { cookie } = await loginAsOwner(app);
      await connect(cookie);
      expect(await prisma.googleConnection.count()).toBe(2);
    });

    it('uma conta revogada não para a sincronização da outra', async () => {
      await connectBoth();
      google.revoked.add('refresh-123');
      google.events.get('work@company.com')!.push({
        id: 'w2',
        summary: 'Almoço',
        start: { dateTime: '2026-10-23T15:00:00Z' },
        end: { dateTime: '2026-10-23T16:00:00Z' },
      });
      // Esquece o access token em cache para o refresh acontecer.
      const accounts = await prisma.googleConnection.findMany({ orderBy: { createdAt: 'asc' } });
      const { forgetAccessToken } = await import('@/services/google/client');
      for (const account of accounts) forgetAccessToken(account.id);

      await syncAllCalendars(userId);
      const status: GoogleStatusResponse = (await api.get('/google/status')).json();
      expect(status.accounts.map((a) => [a.lastError, a.needsReconnect])).toEqual([
        [RECONNECT_MESSAGE, true],
        [null, false],
      ]);
      const list: EventOccurrence[] = (await api.get(range)).json();
      expect(list.map((o) => o.title)).toEqual(['Pessoal', 'Reunião', 'Almoço']);
    });

    it('conta sem Google Agenda mostra o motivo e não pede para reconectar', async () => {
      google.account('google-sub-2').noCalendar = true;
      const status = await connectBoth();
      expect(status.accounts.map((a) => [a.lastError, a.needsReconnect])).toEqual([
        [null, false],
        [NOT_CALENDAR_USER_MESSAGE, false],
      ]);
      const list: EventOccurrence[] = (await api.get(range)).json();
      expect(list.map((o) => o.title)).toEqual(['Pessoal']);

      // Ativou o Google Agenda: "Tentar de novo" sincroniza só esta conta.
      google.account('google-sub-2').noCalendar = false;
      const retried: GoogleStatusResponse = (
        await api.post(`/google/accounts/${status.accounts[1].id}/sync`)
      ).json();
      expect(retried.accounts[1].lastError).toBeNull();
      expect(retried.calendars.some((c) => c.name === 'Trabalho')).toBe(true);
    });

    it('desconectar uma conta mantém a outra', async () => {
      const status = await connectBoth();
      const [first, second] = status.accounts;
      expect((await api.delete(`/google/accounts/${first.id}`)).statusCode).toBe(204);

      const after: GoogleStatusResponse = (await api.get('/google/status')).json();
      expect(after.accounts.map((a) => a.id)).toEqual([second.id]);
      expect(after.tasksAccountId).toBeNull();
      // O padrão era da conta que saiu: passa para o principal da outra.
      expect(after.defaultCalendarId).toBe(after.calendars.find((c) => c.name === 'Trabalho')!.id);
      const list: EventOccurrence[] = (await api.get(range)).json();
      expect(list.map((o) => o.title)).toEqual(['Reunião']);
    });

    it('troca a conta do Google Tasks', async () => {
      const local = (await api.post('/tasks', { title: 'Comprar pão' })).json();
      const status = await connectBoth();
      await syncTasks(userId);
      const before = await prisma.task.findUniqueOrThrow({ where: { id: local.id } });
      expect(before.googleTaskId).toBeTruthy();

      const second = status.accounts[1];
      const switched: GoogleStatusResponse = (
        await api.put('/google/tasks-account', { accountId: second.id })
      ).json();
      expect(switched.tasksAccountId).toBe(second.id);
      expect(switched.accounts.map((a) => a.syncTasks)).toEqual([false, true]);
      // A tarefa subiu de novo, agora pela segunda conta.
      const after = await prisma.task.findUniqueOrThrow({ where: { id: local.id } });
      expect(after.syncState).toBe('SYNCED');
      expect(after.googleTaskId).not.toBe(before.googleTaskId);
      expect(
        google.calls.some(
          (c) => c.method === 'POST' && c.url.includes('/tasks') && c.body?.title === 'Comprar pão'
        )
      ).toBe(true);

      // "Nenhuma": as tarefas ficam só no Jottape.
      const none: GoogleStatusResponse = (
        await api.put('/google/tasks-account', { accountId: null })
      ).json();
      expect(none.tasksAccountId).toBeNull();
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: local.id } })).googleTaskId
      ).toBeNull();
    });

    it('login com Google entra por qualquer conta conectada', async () => {
      await connectBoth();
      google.nextAccount = 'google-sub-2';
      const ok = await connect('', 'login');
      expect(ok.headers.location).toMatch(/\/$/);
      expect(ok.cookies.find((c) => c.name === 'jottape_session')?.value).toBeTruthy();
    });

    it('recusa uma conta Google que já está ligada a outro usuário', async () => {
      const other = await prisma.user.create({
        data: { name: 'Outra', email: 'outra@example.com' },
      });
      await prisma.googleConnection.create({
        data: {
          userId: other.id,
          googleSub: 'google-sub-2',
          googleEmail: 'trabalho@example.com',
          refreshTokenEncrypted: 'x',
          scope: 'x',
        },
      });
      google.nextAccount = 'google-sub-2';
      const response = await connect((await loginAsOwner(app)).cookie);
      expect(response.headers.location).toContain('/ajustes?erro=conta-em-uso');
      expect(await prisma.googleConnection.count({ where: { userId } })).toBe(0);
    });
  });
});
