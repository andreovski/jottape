import ky, { HTTPError } from 'ky';

// O navegador só conhece /api: em produção o server.mjs repassa para a API pela rede privada do
// Railway, em dev o proxy do Vite faz o mesmo. Um domínio só deixa o cookie de sessão funcionar em
// qualquer navegador (inclusive o Safari, que bloqueia cookie de terceiros).
export const api = ky.create({
  prefixUrl: '/api',
  credentials: 'include',
  retry: 0,
  timeout: 30_000,
});

/** Mensagem legível de um erro da API (as mensagens de regra de negócio já vêm em português). */
export async function errorMessage(error: unknown): Promise<string> {
  if (error instanceof HTTPError) {
    try {
      const body = (await error.response.clone().json()) as { message?: string };
      if (body.message && body.message !== 'Validation error.') return body.message;
      if (body.message === 'Validation error.') return 'Confira os campos e tente de novo.';
    } catch {
      // Sem corpo JSON.
    }
    if (error.response.status >= 500) return 'O servidor não respondeu. Tente de novo.';
  }
  if (error instanceof TypeError) return 'Sem conexão com o servidor.';
  return 'Algo deu errado. Tente de novo.';
}

export function isUnauthorized(error: unknown) {
  return error instanceof HTTPError && error.response.status === 401;
}
