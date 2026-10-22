import { decrypt } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

// Chamadas à API da Pluggy com fetch puro, com as chaves do próprio usuário (cada um tem a sua
// aplicação no painel da Pluggy, ligada ao Meu Pluggy dele). Os testes trocam o fetch global.

export const PLUGGY_URL = 'https://api.pluggy.ai';

export class PluggyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`Pluggy API ${status}: ${body.slice(0, 300)}`);
  }
}

export const INVALID_KEYS_MESSAGE =
  'A Pluggy não aceitou o Client ID e o Client Secret. Confira as chaves no painel da Pluggy.';

export interface PluggyItem {
  id: string;
  status: string;
  executionStatus?: string;
  connector?: { id: number; name: string; imageUrl?: string };
  error?: { code?: string; message?: string } | null;
  lastUpdatedAt?: string | null;
}

export interface PluggyAccount {
  id: string;
  type: 'BANK' | 'CREDIT';
  subtype?: string;
  number?: string | null;
  name: string;
  marketingName?: string | null;
  balance: number;
  creditData?: { balanceCloseDate?: string | null; balanceDueDate?: string | null } | null;
}

export interface PluggyTransaction {
  id: string;
  description: string;
  descriptionRaw?: string | null;
  amount: number;
  amountInAccountCurrency?: number | null;
  date: string;
  type?: 'DEBIT' | 'CREDIT';
  status?: 'POSTED' | 'PENDING';
  category?: string | null;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    purchaseDate?: string | null;
  } | null;
}

/** A chave da API vale 2 h; guardamos por usuário um pouco menos que isso. */
const API_KEY_TTL_MS = 100 * 60_000;
const apiKeys = new Map<string, { key: string; expiresAt: number }>();

export function forgetPluggyKey(userId: string) {
  apiKeys.delete(userId);
}

/** Troca Client ID e Secret por uma chave da API. 401/403 viram a mensagem de chaves inválidas. */
export async function authenticatePluggy(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(`${PLUGGY_URL}/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  const text = await response.text();
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new AppError(400, INVALID_KEYS_MESSAGE);
  }
  if (!response.ok) throw new PluggyApiError(response.status, text);
  return (JSON.parse(text) as { apiKey: string }).apiKey;
}

async function apiKeyFor(userId: string): Promise<string> {
  const cached = apiKeys.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.key;
  const credential = await prisma.pluggyCredential.findUnique({ where: { userId } });
  if (!credential) throw new AppError(400, 'Salve antes as chaves da Pluggy.');
  const key = await authenticatePluggy(
    credential.clientId,
    decrypt(credential.clientSecretEncrypted)
  );
  apiKeys.set(userId, { key, expiresAt: Date.now() + API_KEY_TTL_MS });
  return key;
}

/** GET/POST na Pluggy com a chave do usuário; chave vencida (401/403) é renovada uma vez. */
export async function pluggyFetch<T>(
  userId: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
  retried = false
): Promise<T> {
  const response = await fetch(`${PLUGGY_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'x-api-key': await apiKeyFor(userId),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await response.text();
  if ((response.status === 401 || response.status === 403) && !retried) {
    forgetPluggyKey(userId);
    return pluggyFetch(userId, path, init, true);
  }
  if (!response.ok) throw new PluggyApiError(response.status, text);
  return (text ? JSON.parse(text) : null) as T;
}

export const fetchItem = (userId: string, itemId: string) =>
  pluggyFetch<PluggyItem>(userId, `/items/${encodeURIComponent(itemId)}`);

export async function fetchAccounts(userId: string, itemId: string): Promise<PluggyAccount[]> {
  const page = await pluggyFetch<{ results: PluggyAccount[] }>(
    userId,
    `/accounts?itemId=${encodeURIComponent(itemId)}`
  );
  return page.results;
}

/** Todos os lançamentos da conta desde `dateFrom` (AAAA-MM-DD), seguindo o cursor. */
export async function fetchTransactions(
  userId: string,
  accountId: string,
  dateFrom: string
): Promise<PluggyTransaction[]> {
  const all: PluggyTransaction[] = [];
  let query: string | null =
    `?accountId=${encodeURIComponent(accountId)}&dateFrom=${encodeURIComponent(dateFrom)}`;
  // Teto de páginas: uma conta pessoal não tem tanto lançamento, e isto evita laço sem fim.
  for (let page = 0; query && page < 50; page++) {
    const result: { results: PluggyTransaction[]; next: string | null } = await pluggyFetch(
      userId,
      `/v2/transactions${query}`
    );
    all.push(...result.results);
    query = result.next;
  }
  return all;
}

export async function createConnectToken(userId: string): Promise<string> {
  const result = await pluggyFetch<{ accessToken: string }>(userId, '/connect_token', {
    method: 'POST',
    // Sem avoidDuplicates: cada banco do Meu Pluggy é um item, todos com a mesma autorização, e a
    // Pluggy recusaria o segundo (ITEM_USER_ALREADY_EXISTS).
    body: { options: { clientUserId: userId } },
  });
  return result.accessToken;
}

/** Id do conector do Meu Pluggy na aplicação do usuário (null se não achar: o widget lista tudo). */
export async function meuPluggyConnectorIds(userId: string): Promise<number[] | null> {
  try {
    const result = await pluggyFetch<{ results: { id: number; name: string }[] }>(
      userId,
      '/connectors?name=MeuPluggy'
    );
    const ids = result.results
      .filter((c) => c.name.toLowerCase().replace(/\s/g, '').includes('meupluggy'))
      .map((c) => c.id);
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}
