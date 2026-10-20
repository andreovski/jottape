import { decrypt, encrypt } from '@/lib/crypto';
import { getAppUrl, getMicrosoftConfig } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { GoogleApiError, GoogleAuthError, RECONNECT_MESSAGE } from '@/services/google/client';

// Microsoft Graph (Outlook, Hotmail, Microsoft 365) com fetch puro, como o do Google. Os erros
// reaproveitam as classes do Google (o resto do código trata "API" e "precisa reconectar" assim).
// Diferença que importa: a Microsoft troca o refresh token a cada renovação, então o novo é
// guardado toda vez.

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
export const GRAPH = 'https://graph.microsoft.com/v1.0';

export const MICROSOFT_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite',
];

export function microsoftRedirectUri() {
  return `${getAppUrl()}/api/microsoft/callback`;
}

export function microsoftAuthorizationUrl(state: string) {
  const config = getMicrosoftConfig();
  if (!config) throw new Error('Microsoft not configured');
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: microsoftRedirectUri(),
    response_type: 'code',
    response_mode: 'query',
    scope: MICROSOFT_SCOPES.join(' '),
    state,
    prompt: 'select_account',
  });
  return `${AUTHORITY}/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const config = getMicrosoftConfig();
  if (!config) throw new Error('Microsoft not configured');
  const response = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: MICROSOFT_SCOPES.join(' '),
      ...params,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    if (text.includes('invalid_grant') || text.includes('interaction_required')) {
      throw new GoogleAuthError('invalid_grant');
    }
    throw new GoogleApiError(response.status, text);
  }
  return JSON.parse(text) as TokenResponse;
}

export function exchangeMicrosoftCode(code: string) {
  return tokenRequest({
    code,
    grant_type: 'authorization_code',
    redirect_uri: microsoftRedirectUri(),
  });
}

export async function fetchMicrosoftProfile(accessToken: string) {
  const response = await fetch(`${GRAPH}/me?$select=id,mail,userPrincipalName,displayName`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new GoogleApiError(response.status, await response.text());
  const me = (await response.json()) as {
    id: string;
    mail?: string | null;
    userPrincipalName?: string;
  };
  return { id: me.id, email: (me.mail || me.userPrincipalName || '').toLowerCase() };
}

const accessTokens = new Map<string, { token: string; expiresAt: number }>();

export function forgetMicrosoftAccessToken(connectionId: string) {
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
    if (token.refresh_token) {
      await prisma.googleConnection.update({
        where: { id: connectionId },
        data: { refreshTokenEncrypted: encrypt(token.refresh_token) },
      });
    }
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

/** fetch autenticado no Graph. `url` pode ser absoluta (nextLink/deltaLink) ou relativa a GRAPH. */
export async function graphFetch<T = unknown>(
  connectionId: string,
  url: string,
  init: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | undefined>;
    headers?: Record<string, string>;
  } = {}
): Promise<T> {
  const token = await accessTokenFor(connectionId);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) query.set(key, value);
  }
  const base = url.startsWith('https://') ? url : `${GRAPH}${url}`;
  const target = query.size ? `${base}${base.includes('?') ? '&' : '?'}${query}` : base;

  const response = await fetch(target, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      // Datas sempre em UTC e descrição em texto puro (o Outlook guarda HTML).
      prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (response.status === 401) forgetMicrosoftAccessToken(connectionId);
  if (!response.ok) throw new GoogleApiError(response.status, await response.text());
  if (response.status === 204) return null as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
