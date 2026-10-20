import type {
  GoogleAccountResponse,
  GoogleCalendarResponse,
  GoogleStatusResponse,
  UpdateGoogleCalendarsBody,
  UpdateGoogleTasksAccountBody,
} from '@jottape/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export function useGoogleStatus() {
  return useQuery({
    queryKey: ['google'],
    queryFn: () => api.get('google/status').json<GoogleStatusResponse>(),
  });
}

/** E-mails das outras contas que também têm este calendário (ex.: um compartilhado). */
export function alsoInEmails(status: GoogleStatusResponse, calendar: GoogleCalendarResponse) {
  return status.calendars
    .filter((c) => calendar.alsoIn.includes(c.id))
    .map((c) => status.accounts.find((a) => a.id === c.accountId)?.email)
    .filter((email): email is string => Boolean(email));
}

/** Ligado aqui e noutra conta: os eventos aparecem duas vezes na Agenda. */
export function isShownTwice(status: GoogleStatusResponse, calendar: GoogleCalendarResponse) {
  return (
    calendar.selected && status.calendars.some((c) => c.selected && calendar.alsoIn.includes(c.id))
  );
}

/** Subtítulo do calendário nas listas: avisa quando ele também está noutra conta. */
export function alsoInLabel(status: GoogleStatusResponse, calendar: GoogleCalendarResponse) {
  const emails = alsoInEmails(status, calendar);
  if (!emails.length) return undefined;
  return isShownTwice(status, calendar)
    ? `Também ligado em ${emails.join(', ')} (aparece duas vezes)`
    : `Também em ${emails.join(', ')}`;
}

/** Corpo do PUT /google/calendars a partir do estado atual, com uma mudança aplicada. */
export function calendarsBody(
  status: GoogleStatusResponse,
  change: {
    selected?: { id: string; on: boolean };
    defaultCalendarId?: string | null;
    color?: { id: string; color: string | null };
  }
): UpdateGoogleCalendarsBody {
  return {
    selectedIds: status.calendars
      .filter((c) => (c.id === change.selected?.id ? change.selected.on : c.selected))
      .map((c) => c.id),
    defaultCalendarId:
      change.defaultCalendarId !== undefined ? change.defaultCalendarId : status.defaultCalendarId,
    ...(change.color ? { colors: { [change.color.id]: change.color.color } } : {}),
  };
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

export function useSetTasksAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateGoogleTasksAccountBody) =>
      api
        .put('google/tasks-account', { json: body, timeout: 120_000 })
        .json<GoogleStatusResponse>(),
    onSuccess: (status) => {
      client.setQueryData(['google'], status);
      client.invalidateQueries({ queryKey: ['tasks'] });
      client.invalidateQueries({ queryKey: ['task-lists'] });
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

export function useSyncGoogleAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      api
        .post(`google/accounts/${accountId}/sync`, { timeout: 120_000 })
        .json<GoogleStatusResponse>(),
    onSuccess: (status) => {
      client.setQueryData(['google'], status);
      client.invalidateQueries({ queryKey: ['events'] });
      client.invalidateQueries({ queryKey: ['agenda'] });
    },
  });
}

export function useDisconnectGoogleAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => api.delete(`google/accounts/${accountId}`),
    onSuccess: () => client.invalidateQueries(),
  });
}

/** O OAuth é uma navegação de página inteira (o Google não abre em iframe nem em fetch). */
export function startGoogle(intent: 'login' | 'connect') {
  window.location.href = `/api/google/auth?intent=${intent}`;
}

/** Conectar uma conta da Microsoft (Outlook, Microsoft 365) para a Agenda. */
export function startMicrosoft() {
  window.location.href = '/api/microsoft/auth';
}

/** Reconectar a conta pelo provedor dela. */
export function reconnect(account: GoogleAccountResponse) {
  if (account.provider === 'MICROSOFT') startMicrosoft();
  else startGoogle('connect');
}

export const PROVIDER_NAME = { GOOGLE: 'Google', MICROSOFT: 'Microsoft' } as const;
