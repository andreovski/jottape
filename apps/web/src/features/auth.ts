import type { LoginBody, MeResponse, RegisterBody, UpdateProfileBody } from '@jottape/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { api, isUnauthorized } from '@/lib/api';

/** O perfil. `null` = sem sessão (mostra o login). */
export function useMe() {
  return useQuery<MeResponse | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get('me').json<MeResponse>();
      } catch (error) {
        if (isUnauthorized(error)) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * O perfil de quem está dentro do app, entregue pelo AuthGate. Diferente de `useMe().data`, nunca é
 * nulo: só muda quando o AuthGate re-renderiza, e nesse momento ele já troca o app pelo login. Ler
 * a consulta direto deixava uma página aberta re-renderizar com `null` logo após o logout.
 */
export const CurrentUserContext = createContext<MeResponse | null>(null);

export function useCurrentUser(): MeResponse {
  const me = useContext(CurrentUserContext);
  if (!me) throw new Error('useCurrentUser fora do AuthGate.');
  return me;
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginBody) => api.post('sessions', { json: body }).json<MeResponse>(),
    onSuccess: (me) => client.setQueryData(['me'], me),
    meta: { silent: true },
  });
}

export function useRegister() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterBody) => api.post('users', { json: body }).json<MeResponse>(),
    onSuccess: (me) => client.setQueryData(['me'], me),
    meta: { silent: true },
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('sessions'),
    onSuccess: () => {
      // Primeiro avisa quem observa ['me'] (o AuthGate troca o app pelo login), depois descarta o
      // resto. Um clear() antes deixava os observadores presos na consulta removida: o AuthGate
      // não via a saída e a página aberta re-renderizava com o perfil nulo ("t.name").
      client.setQueryData(['me'], null);
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    },
  });
}

export function useUpdateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileBody) => api.patch('me', { json: body }).json<MeResponse>(),
    onSuccess: (me) => {
      client.setQueryData(['me'], me);
      client.invalidateQueries();
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword?: string; newPassword: string }) =>
      api.patch('me/password', { json: body }),
  });
}
