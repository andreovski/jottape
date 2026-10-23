import type {
  AcceptBankMovementBody,
  BankAdminResponse,
  BankCardCheckResponse,
  BankFeedbackBody,
  BankConnectTokenResponse,
  BankMovementResponse,
  BankStatusResponse,
  LinkBankAccountBody,
  SaveBankCredentialsBody,
} from '@jottape/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

// Bancos pelo Meu Pluggy. Ler o banco pode levar um tempo (a Pluggy pagina os lançamentos).
const SLOW = { timeout: 120_000 };

/** Estado dos bancos. Fora do beta a API responde 403: sem retentar, e a tela some. */
export function useBankStatus() {
  return useQuery({
    queryKey: ['bank'],
    queryFn: () => api.get('bank').json<BankStatusResponse>(),
    retry: false,
  });
}

/** O cartão ligado como o banco vê, lido na Pluggy na hora (só quando a seção abre). */
export function useBankCardCheck(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['bank-card-check', accountId],
    queryFn: () => api.get(`bank/cards/${accountId}/check`).json<BankCardCheckResponse>(),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function usePendingMovements() {
  return useQuery({
    queryKey: ['bank', 'movements'],
    queryFn: () => api.get('bank/movements').json<BankMovementResponse[]>(),
  });
}

/** Mudou o banco: estado, revisão e, como entram lançamentos, tudo que é financeiro. */
function useInvalidateBank() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ['bank', 'accounts', 'transactions', 'invoices', 'budgets', 'reports', 'agenda'].map((key) =>
        client.invalidateQueries({ queryKey: [key] })
      )
    );
}

function useBankMutation<T, R>(run: (input: T) => Promise<R>) {
  const invalidate = useInvalidateBank();
  return useMutation({ mutationFn: run, onSuccess: () => invalidate() });
}

export const useAcceptBankNotice = () =>
  useBankMutation(() => api.post('bank/notice').json<BankStatusResponse>());

export const useSaveBankCredentials = () =>
  useBankMutation((body: SaveBankCredentialsBody) =>
    api.put('bank/credentials', { json: body }).json<BankStatusResponse>()
  );

export const useRemoveBankCredentials = () => useBankMutation(() => api.delete('bank/credentials'));

export const useAddBankItem = () =>
  useBankMutation((itemId: string) =>
    api.post('bank/items', { json: { itemId }, ...SLOW }).json<BankStatusResponse>()
  );

export const useRemoveBankItem = () =>
  useBankMutation((id: string) => api.delete(`bank/items/${id}`));

export const useLinkBankAccount = () =>
  useBankMutation(({ id, body }: { id: string; body: LinkBankAccountBody }) =>
    api.patch(`bank/accounts/${id}`, { json: body, ...SLOW }).json<BankStatusResponse>()
  );

export const useSyncBank = () =>
  useBankMutation(() => api.post('bank/sync', SLOW).json<BankStatusResponse>());

export const useAcceptMovement = () =>
  useBankMutation(({ id, body }: { id: string; body: AcceptBankMovementBody }) =>
    api.post(`bank/movements/${id}/accept`, { json: body }).json<BankMovementResponse>()
  );

export const useAcceptAllMovements = () =>
  useBankMutation(() => api.post('bank/movements/accept-all', SLOW).json<{ imported: number }>());

export const useIgnoreMovement = () =>
  useBankMutation((id: string) => api.post(`bank/movements/${id}/ignore`));

export const useSendBankFeedback = () =>
  useMutation({
    mutationFn: (body: BankFeedbackBody) => api.post('bank/feedback', { json: body }),
  });

// ---------------------------------------------------------------- painel do beta (só o dono)

const ADMIN_KEY = ['bank-admin'];

export function useBankAdmin() {
  return useQuery({
    queryKey: ADMIN_KEY,
    queryFn: () => api.get('bank/admin').json<BankAdminResponse>(),
    retry: false,
  });
}

function useBankAdminMutation<T>(call: (input: T) => Promise<BankAdminResponse>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: (data) => client.setQueryData(ADMIN_KEY, data),
  });
}

export const useUpdateBankUser = () =>
  useBankAdminMutation(({ id, bankAccess }: { id: string; bankAccess: boolean }) =>
    api.patch(`bank/admin/users/${id}`, { json: { bankAccess } }).json<BankAdminResponse>()
  );

export const useResolveBankFeedback = () =>
  useBankAdminMutation((id: string) =>
    api.post(`bank/admin/feedback/${id}/resolve`).json<BankAdminResponse>()
  );

/**
 * Abre o widget da Pluggy (Pluggy Connect) já no conector do Meu Pluggy. O pacote só carrega
 * quando a pessoa toca em "Conectar banco". Resolve com o id do item criado, ou null se fechou.
 */
export async function openPluggyConnect(theme: 'light' | 'dark'): Promise<string | null> {
  const [{ PluggyConnect }, token] = await Promise.all([
    import('pluggy-connect-sdk'),
    api.post('bank/connect-token').json<BankConnectTokenResponse>(),
  ]);
  return new Promise((resolve, reject) => {
    let done = false;
    const widget = new PluggyConnect({
      connectToken: token.accessToken,
      ...(token.connectorIds
        ? { connectorIds: token.connectorIds, selectedConnectorId: token.connectorIds[0] }
        : {}),
      language: 'pt',
      theme,
      onSuccess: ({ item }) => {
        done = true;
        resolve(item.id);
      },
      onError: ({ message }) => {
        done = true;
        reject(new Error(message || 'A Pluggy não conseguiu conectar o banco.'));
      },
      onClose: () => {
        if (!done) resolve(null);
      },
    });
    widget.init().catch(reject);
  });
}

export const PLUGGY_LINKS = {
  meuPluggy: 'https://meu.pluggy.ai',
  dashboard: 'https://dashboard.pluggy.ai',
};
