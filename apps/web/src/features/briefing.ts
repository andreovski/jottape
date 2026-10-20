import type {
  BriefingCity,
  BriefingResponse,
  BriefingSettings,
  NextEventResponse,
  StockQuote,
} from '@jottape/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

/** Frases do briefing. Toda mutação bem-sucedida invalida (ver `query-client`). */
export function useBriefing() {
  return useQuery({
    queryKey: ['briefing'],
    queryFn: () => api.get('briefing').json<BriefingResponse>(),
  });
}

export function useBriefingSettings() {
  return useQuery({
    queryKey: ['briefing-settings'],
    queryFn: () => api.get('briefing/settings').json<BriefingSettings>(),
  });
}

export function useSaveBriefingSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: BriefingSettings) =>
      api.put('briefing/settings', { json: settings }).json<BriefingSettings>(),
    // Otimista: o interruptor e a ordem mudam na hora.
    onMutate: async (settings) => {
      await client.cancelQueries({ queryKey: ['briefing-settings'] });
      const previous = client.getQueryData<BriefingSettings>(['briefing-settings']);
      client.setQueryData(['briefing-settings'], settings);
      return { previous };
    },
    onError: (_error, _settings, context) => {
      if (context?.previous) client.setQueryData(['briefing-settings'], context.previous);
    },
    onSuccess: (saved) => client.setQueryData(['briefing-settings'], saved),
  });
}

export function useCitySearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['briefing-cities', q.toLowerCase()],
    queryFn: () => api.get('briefing/cities', { searchParams: { q } }).json<BriefingCity[]>(),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}

/** Cotação de uma ação, para conferir o código antes de adicionar. */
export function useStockLookup() {
  return useMutation({
    mutationFn: (ticker: string) =>
      api.get('briefing/stocks', { searchParams: { ticker } }).json<StockQuote>(),
  });
}

/** Primeiro compromisso a partir de `from` (até 90 dias), para quando o dia está vazio. */
export function useNextEvent(from: Date, enabled = true) {
  return useQuery({
    queryKey: ['agenda', 'next', from.toISOString()],
    queryFn: () =>
      api
        .get('events/next', { searchParams: { from: from.toISOString() } })
        .json<NextEventResponse>(),
    enabled,
  });
}
