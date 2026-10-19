import type { LoginBody, MeResponse, RegisterBody, UpdateProfileBody } from '@jottape/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
      client.clear();
      client.setQueryData(['me'], null);
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
