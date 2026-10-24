import type {
  AgendaResponse,
  CreateEventBody,
  DeleteEventQuery,
  EventOccurrence,
  EventResponse,
  UpdateEventBody,
} from '@jottape/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

function useInvalidateAgenda() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['events'] }),
      client.invalidateQueries({ queryKey: ['agenda'] }),
    ]);
}

/** Ocorrências que se sobrepõem a [from, to). */
export function useEvents(from: Date, to: Date) {
  return useQuery({
    queryKey: ['events', from.toISOString(), to.toISOString()],
    queryFn: () =>
      api
        .get('events', { searchParams: { from: from.toISOString(), to: to.toISOString() } })
        .json<EventOccurrence[]>(),
    placeholderData: (previous) => previous,
  });
}

/** Eventos, tarefas, contas e faturas do intervalo (a tela Hoje). */
export function useAgenda(from: Date, to: Date) {
  return useQuery({
    queryKey: ['agenda', from.toISOString(), to.toISOString()],
    queryFn: () =>
      api
        .get('agenda', { searchParams: { from: from.toISOString(), to: to.toISOString() } })
        .json<AgendaResponse>(),
    refetchInterval: 5 * 60_000,
  });
}

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: ['events', 'one', id],
    enabled: Boolean(id),
    queryFn: () => api.get(`events/${id}`).json<EventResponse>(),
  });
}

export function useCreateEvent() {
  const invalidate = useInvalidateAgenda();
  return useMutation({
    mutationFn: (body: CreateEventBody) => api.post('events', { json: body }).json<EventResponse>(),
    onSuccess: invalidate,
  });
}

export function useUpdateEvent() {
  const invalidate = useInvalidateAgenda();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<UpdateEventBody> & { id: string }) =>
      api.patch(`events/${id}`, { json: body }).json<EventResponse>(),
    onSuccess: invalidate,
  });
}

export function useDeleteEvent() {
  const invalidate = useInvalidateAgenda();
  return useMutation({
    mutationFn: ({
      id,
      scope = 'all',
      occurrenceStart,
    }: Partial<DeleteEventQuery> & { id: string }) =>
      api.delete(`events/${id}`, {
        searchParams: { scope, ...(occurrenceStart ? { occurrenceStart } : {}) },
      }),
    onSuccess: invalidate,
  });
}
