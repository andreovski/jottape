import type { AccountResponse, InvoiceResponse } from '@jottape/schemas';
import { useQueries } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface CardInvoice {
  account: AccountResponse;
  invoice: InvoiceResponse;
}

/**
 * Faturas não pagas de todos os cartões, por vencimento. Usa a mesma chave de `useInvoices`, então
 * divide o cache com a tela da conta.
 */
export function useUnpaidCardInvoices(accounts: AccountResponse[]) {
  const cards = accounts.filter((a) => a.type === 'CREDIT_CARD' && !a.archived);
  const results = useQueries({
    queries: cards.map((card) => ({
      queryKey: ['invoices', card.id],
      queryFn: () => api.get(`accounts/${card.id}/invoices`).json<InvoiceResponse[]>(),
    })),
  });
  const isLoading = results.some((r) => r.isLoading);
  const invoices: CardInvoice[] = results
    .flatMap((result, i) =>
      (result.data ?? [])
        .filter((invoice) => invoice.status !== 'PAID' && invoice.totalCents > 0)
        .map((invoice) => ({ account: cards[i], invoice }))
    )
    .sort((a, b) => (a.invoice.dueDate < b.invoice.dueDate ? -1 : 1));
  return { invoices, isLoading };
}
