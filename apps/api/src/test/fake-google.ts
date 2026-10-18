/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';

/**
 * Google de mentira: troca o fetch global e responde às rotas que a API usa, com estado em
 * memória (calendários, eventos e tarefas). Cada chamada fica em `calls` para os testes conferirem.
 */
export class FakeGoogle {
  calls: { method: string; url: string; body?: any }[] = [];
  calendars = [
    { id: 'primary@gmail.com', summary: 'André', primary: true, backgroundColor: '#4285f4' },
    { id: 'family@group', summary: 'Família', backgroundColor: '#0b8043' },
  ];
  events = new Map<string, any[]>([
    ['primary@gmail.com', []],
    ['family@group', []],
  ]);
  syncTokenGone = false;
  taskLists = [
    { id: 'default-list', title: 'Minhas tarefas' },
    { id: 'shopping', title: 'Compras' },
  ];
  tasks = new Map<string, any[]>([
    ['default-list', []],
    ['shopping', []],
  ]);
  private seq = 0;

  install() {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => this.handle(String(input), init))
    );
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    return this;
  }

  uninstall() {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }

  private json(status: number, data: unknown) {
    return new Response(data === null ? null : JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  private async handle(raw: string, init?: RequestInit): Promise<Response> {
    const url = new URL(raw);
    const method = init?.method ?? 'GET';
    let body: any;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = Object.fromEntries(new URLSearchParams(init.body));
      }
    } else if (init?.body instanceof URLSearchParams) {
      body = Object.fromEntries(init.body);
    }
    this.calls.push({ method, url: raw, body });
    const path = decodeURIComponent(url.pathname);

    if (url.host === 'oauth2.googleapis.com' && path === '/token') {
      return this.json(200, {
        access_token: 'access',
        expires_in: 3600,
        refresh_token: body.grant_type === 'authorization_code' ? 'refresh-123' : undefined,
        scope: 'openid email calendar tasks',
      });
    }
    if (url.host === 'openidconnect.googleapis.com') {
      return this.json(200, {
        sub: 'google-sub-1',
        email: 'andre@example.com',
        email_verified: true,
      });
    }
    if (url.host === 'oauth2.googleapis.com' && path === '/revoke') return this.json(200, {});

    // ---- Calendar
    if (path === '/calendar/v3/users/me/calendarList')
      return this.json(200, { items: this.calendars });
    if (path === '/calendar/v3/channels/stop') return this.json(204, null);
    let match = path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (match) {
      const [, calendarId, eventId] = match;
      const list = this.events.get(calendarId)!;
      if (eventId === 'watch')
        return this.json(200, {
          resourceId: 'res',
          expiration: String(Date.now() + 7 * 86_400_000),
        });
      if (!eventId && method === 'GET') {
        if (url.searchParams.get('syncToken') && this.syncTokenGone) {
          this.syncTokenGone = false;
          return this.json(410, { error: 'gone' });
        }
        return this.json(200, { items: list, nextSyncToken: `token-${++this.seq}` });
      }
      if (!eventId && method === 'POST') {
        const created = { ...body, id: `g-${++this.seq}`, etag: '"1"', status: 'confirmed' };
        list.push(created);
        return this.json(200, created);
      }
      if (method === 'PATCH') {
        const existing = list.find((e) => e.id === eventId);
        const updated = { ...(existing ?? { id: eventId }), ...body, etag: `"${++this.seq}"` };
        if (!existing) list.push(updated);
        else Object.assign(existing, updated);
        return this.json(200, updated);
      }
      if (method === 'DELETE') {
        this.events.set(
          calendarId,
          list.filter((e) => e.id !== eventId)
        );
        return this.json(204, null);
      }
    }

    // ---- Tasks
    if (path === '/tasks/v1/users/@me/lists/@default') return this.json(200, this.taskLists[0]);
    if (path === '/tasks/v1/users/@me/lists' && method === 'GET')
      return this.json(200, { items: this.taskLists });
    if (path === '/tasks/v1/users/@me/lists' && method === 'POST') {
      const list = { id: `list-${++this.seq}`, title: body.title };
      this.taskLists.push(list);
      this.tasks.set(list.id, []);
      return this.json(200, list);
    }
    match = path.match(/^\/tasks\/v1\/users\/@me\/lists\/([^/]+)$/);
    if (match && method === 'DELETE') {
      this.taskLists = this.taskLists.filter((l) => l.id !== match![1]);
      return this.json(204, null);
    }
    match = path.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/);
    if (match) {
      const [, listId, taskId] = match;
      const list = this.tasks.get(listId) ?? [];
      if (!taskId && method === 'GET') return this.json(200, { items: list });
      if (!taskId && method === 'POST') {
        const created = {
          ...body,
          id: `t-${++this.seq}`,
          etag: '"1"',
          parent: url.searchParams.get('parent') ?? undefined,
        };
        list.push(created);
        return this.json(200, created);
      }
      const existing = list.find((t) => t.id === taskId);
      if (!existing) return this.json(404, { error: 'not found' });
      if (method === 'PATCH') {
        Object.assign(existing, body, { etag: `"${++this.seq}"` });
        return this.json(200, existing);
      }
      if (method === 'DELETE') {
        this.tasks.set(
          listId,
          list.filter((t) => t.id !== taskId)
        );
        return this.json(204, null);
      }
    }

    return this.json(404, { error: `fake google: no route for ${method} ${path}` });
  }
}
