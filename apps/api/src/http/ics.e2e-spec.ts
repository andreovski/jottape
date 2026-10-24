import type { EventOccurrence, GoogleStatusResponse } from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '@/app';
import { decrypt } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';
import { syncAllIcs } from '@/services/ics';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

const LINK =
  'https://outlook.office365.com/owa/calendar/abc123@empresa.com/s3gr3d0/reachcalendar.ics';

/** AAAAMMDD de hoje + `days` (UTC), para o arquivo cair na janela sincronizada. */
function day(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
}

function feed(events: string[]) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Calendário',
    'BEGIN:VTIMEZONE',
    'TZID:E. South America Standard Time',
    'BEGIN:STANDARD',
    'DTSTART:16010101T000000',
    'TZOFFSETFROM:-0300',
    'TZOFFSETTO:-0300',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

const meeting = (title = 'Reunião de planejamento') =>
  [
    'BEGIN:VEVENT',
    'UID:REUNIAO',
    `SUMMARY:${title}`,
    `DTSTART;TZID=E. South America Standard Time:${day(1)}T100000`,
    `DTEND;TZID=E. South America Standard Time:${day(1)}T110000`,
    'LOCATION:Microsoft Teams',
    'END:VEVENT',
  ].join('\r\n');

const daily = [
  'BEGIN:VEVENT',
  'UID:DAILY',
  'SUMMARY:Daily',
  `DTSTART;TZID=E. South America Standard Time:${day(-1)}T093000`,
  `DTEND;TZID=E. South America Standard Time:${day(-1)}T094500`,
  'RRULE:FREQ=DAILY;COUNT=5',
  'END:VEVENT',
].join('\r\n');

describe('Agenda por link (ICS)', () => {
  let api: ReturnType<typeof client>;
  let userId: string;
  /** Servidor de mentira: o arquivo de cada link, com ETag. */
  let files: Map<string, { status: number; body: string; etag?: string }>;
  let requests: { url: string; ifNoneMatch: string | null }[];

  beforeAll(() => app.ready());
  afterAll(() => app.close());
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    await resetDatabase();
    files = new Map([[LINK, { status: 200, body: feed([meeting(), daily]), etag: '"v1"' }]]);
    requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const ifNoneMatch = new Headers(init?.headers).get('if-none-match');
        requests.push({ url, ifNoneMatch });
        const file = files.get(url);
        if (!file) return new Response('not found', { status: 404 });
        if (file.etag && ifNoneMatch === file.etag) return new Response(null, { status: 304 });
        return new Response(file.body, {
          status: file.status,
          headers: file.etag ? { etag: file.etag } : {},
        });
      })
    );
    const session = await loginAsOwner(app);
    api = client(app, session.cookie);
    userId = session.user.id;
  });

  const range = () =>
    `/events?from=${new Date(Date.now() - 3 * 86_400_000).toISOString()}&to=${new Date(Date.now() + 10 * 86_400_000).toISOString()}`;

  async function events() {
    return (await api.get(range())).json() as EventOccurrence[];
  }

  async function add(body: Record<string, unknown> = {}) {
    return api.post('/google/ics', { url: LINK.replace('https://', 'webcal://'), ...body });
  }

  it('adiciona pelo link webcal, mostra os eventos e não devolve o link', async () => {
    const response = await add({ name: 'Trabalho', color: '#5856d6' });
    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain('s3gr3d0');
    expect(requests[0].url).toBe(LINK);

    const status = response.json() as GoogleStatusResponse;
    expect(status.connected).toBe(true);
    expect(status.accounts).toMatchObject([
      { provider: 'ICS', email: 'outlook.office365.com', syncTasks: false, lastError: null },
    ]);
    expect(status.calendars).toMatchObject([
      { name: 'Trabalho', color: '#5856d6', selected: true, readOnly: true, alsoIn: [] },
    ]);
    // Agenda por link não vira a padrão.
    expect(status.defaultCalendarId).toBeNull();

    const connection = await prisma.googleConnection.findFirstOrThrow({ where: { userId } });
    expect(connection.refreshTokenEncrypted).not.toContain('s3gr3d0');
    expect(decrypt(connection.refreshTokenEncrypted)).toBe(LINK);

    const list = await events();
    const planning = list.find((e) => e.title === 'Reunião de planejamento')!;
    expect(planning).toMatchObject({
      source: 'ICS',
      calendarId: status.calendars[0].id,
      location: 'Microsoft Teams',
      isRecurring: false,
    });
    expect(planning.startAt.slice(11, 16)).toBe('13:00');
    expect(list.filter((e) => e.title === 'Daily')).toHaveLength(5);
  });

  it('sem nome, usa o do arquivo', async () => {
    const status = (await add()).json() as GoogleStatusResponse;
    expect(status.calendars[0].name).toBe('Calendário');
  });

  it('recusa link que não é agenda, link fora do ar e link repetido', async () => {
    files.set(LINK, { status: 200, body: '<!doctype html><title>Entrar</title>' });
    const html = await add();
    expect(html.statusCode).toBe(400);
    expect(html.json().message).toContain('não é de uma agenda');

    files.delete(LINK);
    const gone = await add();
    expect(gone.statusCode).toBe(400);
    expect(gone.json().message).toContain('não existe mais');
    expect(gone.body).not.toContain('s3gr3d0');

    const bad = await api.post('/google/ics', { url: 'ftp://example.com/a.ics' });
    expect(bad.statusCode).toBe(400);
    expect(await prisma.googleConnection.count()).toBe(0);

    files.set(LINK, { status: 200, body: feed([meeting()]) });
    expect((await add()).statusCode).toBe(201);
    expect((await api.post('/google/ics', { url: LINK })).statusCode).toBe(409);
  });

  it('a leitura periódica traz mudanças e usa o ETag', async () => {
    await add();
    requests = [];

    // Sem mudança: o servidor responde 304 e nada é regravado.
    await syncAllIcs();
    expect(requests).toEqual([{ url: LINK, ifNoneMatch: '"v1"' }]);

    // Mudou: título novo e a Daily saiu.
    files.set(LINK, { status: 200, body: feed([meeting('Planejamento (movida)')]), etag: '"v2"' });
    await syncAllIcs();
    const list = await events();
    expect(list.map((e) => e.title)).toEqual(['Planejamento (movida)']);
    const status = (await api.get('/google/status')).json() as GoogleStatusResponse;
    expect(status.calendars[0].syncedAt).not.toBeNull();

    // Link fora do ar: o erro aparece na conta, sem o link, e os eventos ficam.
    files.delete(LINK);
    await syncAllIcs();
    const failed = (await api.get('/google/status')).json() as GoogleStatusResponse;
    expect(failed.accounts[0].lastError).toContain('não existe mais');
    expect(JSON.stringify(failed)).not.toContain('s3gr3d0');
    expect(await events()).toHaveLength(1);
  });

  it('é só de leitura', async () => {
    const status = (await add()).json() as GoogleStatusResponse;
    const calendarId = status.calendars[0].id;
    const [event] = await events();

    const edit = await api.patch(`/events/${event.eventId}`, { title: 'outro' });
    expect(edit.statusCode).toBe(400);
    expect(edit.json().message).toContain('só de leitura');
    expect((await api.delete(`/events/${event.eventId}?scope=all`)).statusCode).toBe(400);

    const create = await api.post('/events', {
      title: 'Novo',
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
      endAt: new Date(Date.now() + 90_000_000).toISOString(),
      allDay: false,
      calendarId,
    });
    expect(create.statusCode).toBe(400);

    const asDefault = await api.put('/google/calendars', {
      selectedIds: [calendarId],
      defaultCalendarId: calendarId,
    });
    expect(asDefault.statusCode).toBe(400);
  });

  it('renomeia, troca o link, desliga e remove', async () => {
    const status = (await add()).json() as GoogleStatusResponse;
    const accountId = status.accounts[0].id;
    const calendarId = status.calendars[0].id;

    const renamed = await api.patch(`/google/ics/${accountId}`, { name: 'Empresa' });
    expect((renamed.json() as GoogleStatusResponse).calendars[0].name).toBe('Empresa');

    const other = 'https://calendar.example.com/feeds/novo.ics';
    files.set(other, { status: 200, body: feed([daily]) });
    const moved = await api.patch(`/google/ics/${accountId}`, { url: other });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as GoogleStatusResponse).accounts[0].email).toBe('calendar.example.com');
    expect((await events()).map((e) => e.title)).toEqual(Array(5).fill('Daily'));

    // Desligada some da Agenda.
    await api.put('/google/calendars', { selectedIds: [], defaultCalendarId: null });
    expect(await events()).toEqual([]);
    await api.put('/google/calendars', { selectedIds: [calendarId], defaultCalendarId: null });

    expect((await api.delete(`/google/accounts/${accountId}`)).statusCode).toBe(204);
    expect(await events()).toEqual([]);
    expect(await prisma.event.count()).toBe(0);
  });
});
