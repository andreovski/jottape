import type {
  AssistantAdminResponse,
  AssistantBenchmarkResponse,
  AssistantCardResponse,
  AssistantMessageBody,
  AssistantReplyResponse,
  AssistantStateResponse,
  SaveAssistantCardBody,
  TranscriptionResponse,
  UpdateAssistantUserBody,
} from '@jottape/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

const KEY = ['assistant'];
// O que o Assistente salva ou desfaz mexe nos mesmos lugares que um lançamento, evento ou tarefa
// feito à mão.
const FINANCE_KEYS = [
  'accounts',
  'transactions',
  'invoices',
  'budgets',
  'reports',
  'agenda',
  'events',
  'tasks',
  'task-lists',
];

function useInvalidateFinance() {
  const client = useQueryClient();
  return () =>
    Promise.all(FINANCE_KEYS.map((key) => client.invalidateQueries({ queryKey: [key] })));
}

export function useAssistant() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get('assistant').json<AssistantStateResponse>(),
    staleTime: 60_000,
  });
}

/** Troca um cartão no cache (salvar, desfazer, descartar devolvem o cartão novo). */
function usePatchCard() {
  const client = useQueryClient();
  return (card: AssistantCardResponse) =>
    client.setQueryData<AssistantStateResponse>(KEY, (state) =>
      state
        ? {
            ...state,
            messages: state.messages.map((message) => ({
              ...message,
              cards: message.cards.map((c) => (c.id === card.id ? card : c)),
            })),
          }
        : state
    );
}

export function useSendAssistantMessage() {
  const client = useQueryClient();
  const invalidateFinance = useInvalidateFinance();
  return useMutation({
    // Pergunta faz o Haiku consultar os dados em algumas rodadas: pode passar dos 30 s padrão.
    mutationFn: (body: AssistantMessageBody) =>
      api
        .post('assistant/messages', { json: body, timeout: 60_000 })
        .json<AssistantReplyResponse>(),
    onSuccess: (reply) => {
      client.setQueryData<AssistantStateResponse>(KEY, (state) =>
        state
          ? { ...state, usage: reply.usage, messages: [...state.messages, ...reply.messages] }
          : state
      );
      if (reply.messages.some((m) => m.cards.some((c) => c.status === 'SAVED'))) {
        void invalidateFinance();
      }
    },
  });
}

function useCardAction(action: 'save' | 'undo' | 'discard') {
  const patch = usePatchCard();
  const invalidateFinance = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: SaveAssistantCardBody }) =>
      api
        .post(`assistant/cards/${id}/${action}`, { json: body ?? {} })
        .json<AssistantCardResponse>(),
    onSuccess: (card) => {
      patch(card);
      if (action !== 'discard') void invalidateFinance();
    },
  });
}

export const useSaveAssistantCard = () => useCardAction('save');
export const useUndoAssistantCard = () => useCardAction('undo');
export const useDiscardAssistantCard = () => useCardAction('discard');

export function useClearAssistant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('assistant/messages'),
    onSuccess: () =>
      client.setQueryData<AssistantStateResponse>(KEY, (state) =>
        state ? { ...state, messages: [] } : state
      ),
  });
}

export function useTranscribe() {
  return useMutation({
    mutationFn: ({ audio, seconds }: { audio: Blob; seconds: number }) =>
      api
        .post('assistant/transcriptions', {
          body: audio,
          headers: {
            'content-type': audio.type || 'audio/webm',
            'x-audio-seconds': String(Math.round(seconds)),
          },
        })
        .json<TranscriptionResponse>(),
  });
}

/** "Isso está errado" numa resposta. */
export function useReportMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string | null }) =>
      api.post(`assistant/messages/${id}/feedback`, { json: { note } }),
    onSuccess: (_, { id }) =>
      client.setQueryData<AssistantStateResponse>(KEY, (state) =>
        state
          ? {
              ...state,
              messages: state.messages.map((m) => (m.id === id ? { ...m, reported: true } : m)),
            }
          : state
      ),
  });
}

// ---------------------------------------------------------------- painel do beta

const ADMIN_KEY = ['assistant', 'admin'];

export function useAssistantAdmin() {
  return useQuery({
    queryKey: ADMIN_KEY,
    queryFn: () => api.get('assistant/admin').json<AssistantAdminResponse>(),
  });
}

function useAdminMutation<T>(call: (input: T) => Promise<AssistantAdminResponse>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: (data) => client.setQueryData(ADMIN_KEY, data),
  });
}

export const useUpdateAssistantUser = () =>
  useAdminMutation(({ id, body }: { id: string; body: UpdateAssistantUserBody }) =>
    api.patch(`assistant/admin/users/${id}`, { json: body }).json<AssistantAdminResponse>()
  );

export const useResolveFeedback = () =>
  useAdminMutation(({ id, resolved }: { id: string; resolved: boolean }) =>
    api
      .post(`assistant/admin/feedback/${id}/resolve`, { json: { resolved } })
      .json<AssistantAdminResponse>()
  );

/** Os 60 pedidos levam perto de um minuto. */
export function useRunBenchmark() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api
        .post('assistant/admin/benchmark', { timeout: 180_000 })
        .json<AssistantBenchmarkResponse>(),
    onSuccess: () => client.invalidateQueries({ queryKey: ADMIN_KEY }),
  });
}
