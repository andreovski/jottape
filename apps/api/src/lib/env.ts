// Leitura das variáveis de ambiente num lugar só: quem precisa de uma importa daqui, e a falta de
// uma obrigatória derruba a subida em vez de falhar no meio de uma requisição.

const isProduction = () => process.env.NODE_ENV === 'production';

export function getPort(): number {
  return Number(process.env.PORT) || 3333;
}

/** Origens do CORS. Sem FRONTEND_URL vale o dev do Vite. */
export function getAllowedOrigins(): string[] {
  return (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Endereço público do app (o web). O OAuth do Google volta para `${APP_URL}/api/google/callback`
 * e o webhook do Calendar chega em `${APP_URL}/api/google/webhook`, ambos repassados pelo web.
 */
export function getAppUrl(): string {
  return (process.env.APP_URL || getAllowedOrigins()[0]).replace(/\/$/, '');
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (isProduction()) throw new Error('JWT_SECRET is required in production.');
  return 'jottape-dev-secret';
}

/** Chave de 32 bytes (hex ou base64) que cifra o refresh token do Google no banco. */
export function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (isProduction()) throw new Error('ENCRYPTION_KEY is required in production.');
    return Buffer.alloc(32, 7);
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32)
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64).');
  return key;
}

export function getOwner(): { email: string; password: string | null; name: string } | null {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!email) return null;
  return {
    email,
    password: process.env.OWNER_PASSWORD || null,
    name: process.env.OWNER_NAME || email.split('@')[0],
  };
}

export function getGoogleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function getVapidConfig(): {
  publicKey: string;
  privateKey: string;
  subject: string;
} | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT || 'mailto:owner@jottape.app',
  };
}

/** Os jobs (lembretes, sync do Google, recorrências) rodam dentro da API; nos testes, não. */
export function jobsEnabled(): boolean {
  return process.env.NODE_ENV !== 'test' && process.env.DISABLE_JOBS !== 'true';
}

export function isSecureCookie(): boolean {
  return isProduction();
}
