import { MutationCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { errorMessage, isUnauthorized } from './api';

export function createQueryClient() {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) => !isUnauthorized(error) && count < 1,
        refetchOnWindowFocus: true,
      },
    },
    // Toda mutação que falha mostra o motivo; sessão vencida volta para o login.
    mutationCache: new MutationCache({
      onError: async (error, _vars, _ctx, mutation) => {
        if (isUnauthorized(error)) {
          client.setQueryData(['me'], null);
          return;
        }
        if (mutation.meta?.silent) return;
        toast.error(await errorMessage(error));
      },
    }),
  });
  return client;
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { silent?: boolean };
  }
}
