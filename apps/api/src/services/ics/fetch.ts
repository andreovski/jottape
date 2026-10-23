import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { looksLikeIcs } from './parse';

// Busca do arquivo ICS. O link é segredo (quem tem o link vê a agenda): ele nunca entra em log nem
// em mensagem de erro. Como é um endereço que o usuário digita, só vale http(s) para a internet:
// nada de localhost, rede interna do Railway ou IP privado, nem depois de um redirecionamento.

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export class IcsFetchError extends Error {}

/** webcal:// vira https://; devolve null se não for um link http(s) válido. */
export function normalizeIcsUrl(input: string): string | null {
  const trimmed = input.trim().replace(/^webcals?:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  return url.toString();
}

/** Só o domínio, para mostrar no app ("outlook.office365.com"). */
export function icsHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function isPrivateAddress(address: string): boolean {
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  return (
    v6 === '::' ||
    v6 === '::1' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe8') ||
    v6.startsWith('fe9') ||
    v6.startsWith('fea') ||
    v6.startsWith('feb')
  );
}

async function assertPublic(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new IcsFetchError('Esse endereço não é público.');
  }
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true })
        .then((list) => list.map((item) => item.address))
        .catch(() => {
          throw new IcsFetchError('Não achamos o servidor desse link. Confira o endereço.');
        });
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new IcsFetchError('Esse endereço não é público.');
  }
}

async function readLimited(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new IcsFetchError('A agenda é grande demais (mais de 10 MB).');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

export type IcsFetchResult =
  | { notModified: true }
  | { notModified: false; text: string; etag: string | null };

/** Baixa o ICS. Com `etag`, um 304 do servidor volta como `notModified`. */
export async function fetchIcs(link: string, etag?: string | null): Promise<IcsFetchResult> {
  let url = new URL(link);
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (process.env.NODE_ENV !== 'test') await assertPublic(url);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal,
        headers: {
          accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5',
          'user-agent': 'Jottape/1.0 (agenda por link)',
          ...(etag ? { 'if-none-match': etag } : {}),
        },
      });
    } catch {
      throw new IcsFetchError(
        signal.aborted ? 'O link demorou demais para responder.' : 'Não deu para abrir o link.'
      );
    }

    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get('location');
      if (!location) break;
      const next = new URL(location, url);
      if (next.protocol !== 'https:' && next.protocol !== 'http:') break;
      url = next;
      continue;
    }
    if (response.status === 304) return { notModified: true };
    if (response.status === 404 || response.status === 410) {
      throw new IcsFetchError(
        'O link não existe mais. A agenda pode ter deixado de ser publicada: publique de novo e troque o link.'
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new IcsFetchError('O servidor recusou o acesso a esse link.');
    }
    if (!response.ok) throw new IcsFetchError(`O servidor da agenda respondeu ${response.status}.`);

    const text = await readLimited(response);
    if (!looksLikeIcs(text)) {
      throw new IcsFetchError(
        'Esse link não é de uma agenda (ICS). No Outlook, copie o link que termina em .ics.'
      );
    }
    return { notModified: false, text, etag: response.headers.get('etag') };
  }
  throw new IcsFetchError('O link redireciona demais.');
}
