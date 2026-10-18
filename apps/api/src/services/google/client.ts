import { decrypt } from '@/lib/crypto';
import { getAppUrl, getGoogleConfig } from '@/lib/env';
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
      ? { access_type: 'offline', prompt: 'consent' }
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

const accessTokens = new Map<string, { token: string; expiresAt: number }>();

export function forgetAccessToken(userId: string) {
  accessTokens.delete(userId);
}

async function accessTokenFor(userId: string): Promise<string> {
  const cached = accessTokens.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const connection = await prisma.googleConnection.findUnique({ where: { userId } });
  if (!connection) throw new GoogleAuthError('not connected');

  try {
    const token = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: decrypt(connection.refreshTokenEncrypted),
    });
    accessTokens.set(userId, {
      token: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    });
    return token.access_token;
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      await prisma.googleConnection.update({
        where: { userId },
        data: { lastError: 'O acesso ao Google expirou ou foi revogado. Conecte de novo.' },
      });
    }
    throw error;
  }
}

/** fetch autenticado. Devolve o JSON (ou null em 204). */
export async function googleFetch<T = unknown>(
  userId: string,
  url: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}
): Promise<T> {
  const token = await accessTokenFor(userId);
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

  if (response.status === 401) forgetAccessToken(userId);
  if (!response.ok) throw new GoogleApiError(response.status, await response.text());
  if (response.status === 204) return null as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Há conexão com o Google para este usuário (e o servidor tem as credenciais)? */
export async function isConnected(userId: string): Promise<boolean> {
  if (!getGoogleConfig()) return false;
  return (await prisma.googleConnection.count({ where: { userId } })) > 0;
}

export async function recordError(userId: string, error: unknown) {
  if (error instanceof GoogleAuthError) return;
  const message = error instanceof Error ? error.message : String(error);
  console.error('[google]', message);
  await prisma.googleConnection
    .update({ where: { userId }, data: { lastError: message.slice(0, 500) } })
    .catch(() => undefined);
}
