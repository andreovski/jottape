import type { ConnectionProvider } from '@prisma/client';

import { decrypt } from '@/lib/crypto';
import { getAppUrl, getGoogleConfig, getMicrosoftConfig } from '@/lib/env';
import { prisma } from '@/lib/prisma';

// Chamadas ao Google com fetch puro (sem googleapis): são poucas rotas e assim os testes trocam o
// fetch global por um falso.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export const LOGIN_SCOPES = ['openid', 'email', 'profile'];
export const CONNECT_SCOPES = [
  ...LOGIN_SCOPES,
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
];

export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`Google API ${status}: ${body.slice(0, 300)}`);
  }
}

/** O refresh token foi revogado ou expirou: só reconectando. */
export class GoogleAuthError extends Error {}

export function redirectUri() {
  return `${getAppUrl()}/api/google/callback`;
}

export function authorizationUrl(state: string, intent: 'login' | 'connect') {
  const config = getGoogleConfig();
  if (!config) throw new Error('Google not configured');
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: (intent === 'login' ? LOGIN_SCOPES : CONNECT_SCOPES).join(' '),
    state,
    include_granted_scopes: 'true',
    ...(intent === 'connect'
      ? { access_type: 'offline', prompt: 'consent select_account' }
      : { prompt: 'select_account' }),
  });
  return `${AUTH_URL}?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const config = getGoogleConfig();
  if (!config) throw new Error('Google not configured');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...params,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    if (text.includes('invalid_grant')) throw new GoogleAuthError('invalid_grant');
    throw new GoogleApiError(response.status, text);
  }
  return JSON.parse(text) as TokenResponse;
}

export function exchangeCode(code: string) {
  return tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
}

export async function fetchUserInfo(accessToken: string) {
  const response = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new GoogleApiError(response.status, await response.text());
  return (await response.json()) as {
    sub: string;
    email: string;
    email_verified?: boolean;
    name?: string;
  };
}

// Tudo que fala com o Google é por conta conectada (GoogleConnection): o usuário pode ter várias.
const accessTokens = new Map<string, { token: string; expiresAt: number }>();

export function forgetAccessToken(connectionId: string) {
  accessTokens.delete(connectionId);
}

async function accessTokenFor(connectionId: string): Promise<string> {
  const cached = accessTokens.get(connectionId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const connection = await prisma.googleConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new GoogleAuthError('not connected');

  try {
    const token = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: decrypt(connection.refreshTokenEncrypted),
    });
    accessTokens.set(connectionId, {
      token: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    });
    return token.access_token;
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      await prisma.googleConnection.update({
        where: { id: connectionId },
        data: { lastError: RECONNECT_MESSAGE },
      });
    }
    throw error;
  }
}

export const RECONNECT_MESSAGE = 'O acesso ao Google expirou ou foi revogado. Conecte de novo.';

/** Conta Google sem o Google Agenda ativado (403 notACalendarUser): reconectar não resolve. */
export const NOT_CALENDAR_USER_MESSAGE =
  'Esta conta Google não tem o Google Agenda ativado. Abra calendar.google.com com ela uma vez e depois toque em "Tentar de novo".';

function errorMessage(error: unknown) {
  if (
    error instanceof GoogleApiError &&
    error.status === 403 &&
    error.body.includes('notACalendarUser')
  )
    return NOT_CALENDAR_USER_MESSAGE;
  return error instanceof Error ? error.message : String(error);
}

/** fetch autenticado com a conta `connectionId`. Devolve o JSON (ou null em 204). */
export async function googleFetch<T = unknown>(
  connectionId: string,
  url: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}
): Promise<T> {
  const token = await accessTokenFor(connectionId);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) query.set(key, value);
  }
  const target = query.size ? `${url}?${query}` : url;

  const response = await fetch(target, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (response.status === 401) forgetAccessToken(connectionId);
  if (!response.ok) throw new GoogleApiError(response.status, await response.text());
  if (response.status === 204) return null as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Provedores com as credenciais configuradas no servidor. */
export function configuredProviders(): ConnectionProvider[] {
  return [
    ...(getGoogleConfig() ? (['GOOGLE'] as const) : []),
    ...(getMicrosoftConfig() ? (['MICROSOFT'] as const) : []),
  ];
}

/** Contas de agenda do usuário (Google e Microsoft), só dos provedores configurados. */
export async function connectionsOf(userId: string) {
  return prisma.googleConnection.findMany({
    where: { userId, provider: { in: configuredProviders() } },
    orderBy: { createdAt: 'asc' },
  });
}

/** A conta que sincroniza o Google Tasks, se houver. */
export async function tasksConnection(userId: string) {
  if (!getGoogleConfig()) return null;
  return prisma.googleConnection.findFirst({
    where: { userId, provider: 'GOOGLE', syncTasks: true },
  });
}

/** A conta existe (e o servidor tem as credenciais do provedor)? */
export async function isConnectionActive(connectionId: string): Promise<boolean> {
  return (
    (await prisma.googleConnection.count({
      where: { id: connectionId, provider: { in: configuredProviders() } },
    })) > 0
  );
}

export async function recordError(connectionId: string, error: unknown) {
  if (error instanceof GoogleAuthError) return;
  console.error('[google]', error instanceof Error ? error.message : String(error));
  const message = errorMessage(error);
  await prisma.googleConnection
    .update({ where: { id: connectionId }, data: { lastError: message.slice(0, 500) } })
    .catch(() => undefined);
}

/** Preenche o `sub` de uma conta conectada antes de existir o campo. */
export async function ensureGoogleSub(connectionId: string) {
  const connection = await prisma.googleConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.googleSub) return;
  const info = await googleFetch<{ sub: string }>(connectionId, USERINFO_URL);
  await prisma.googleConnection.update({
    where: { id: connectionId },
    data: { googleSub: info.sub },
  });
}
