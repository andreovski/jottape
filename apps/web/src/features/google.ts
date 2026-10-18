import type { GoogleStatusResponse, UpdateGoogleCalendarsBody } from '@jottape/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export function useGoogleStatus() {
  return useQuery({
    queryKey: ['google'],
    queryFn: () => api.get('google/status').json<GoogleStatusResponse>(),
  });
}

export function useUpdateGoogleCalendars() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateGoogleCalendarsBody) =>
      api.put('google/calendars', { json: body }).json<GoogleStatusResponse>(),
    onSuccess: (status) => {
      client.setQueryData(['google'], status);
      client.invalidateQueries({ queryKey: ['events'] });
      client.invalidateQueries({ queryKey: ['agenda'] });
    },
  });
}

export function useSyncGoogle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('google/sync', { timeout: 120_000 }).json<GoogleStatusResponse>(),
    onSuccess: (status) => {
      client.setQueryData(['google'], status);
      client.invalidateQueries();
    },
  });
}

export function useDisconnectGoogle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('google'),
    onSuccess: () => client.invalidateQueries(),
  });
}

/** O OAuth é uma navegação de página inteira (o Google não abre em iframe nem em fetch). */
export function startGoogle(intent: 'login' | 'connect') {
  window.location.href = `/api/google/auth?intent=${intent}`;
}
