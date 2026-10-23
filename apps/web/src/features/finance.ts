import type {
  AccountResponse,
  BudgetStatusResponse,
  CategoryResponse,
  CreateAccountBody,
  CreateCategoryBody,
  CreateTransactionBody,
  DueInvoicesQuery,
  ForecastResponse,
  InvoiceResponse,
  ListTransactionsQuery,
  MonthSummaryResponse,
  PayInvoiceBody,
  RecurrenceScope,
  TransactionResponse,
  UpdateAccountBody,
  UpdateCategoryBody,
  UpdateTransactionBody,
  UpsertBudgetBody,
} from '@jottape/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

// Qualquer mudança em dinheiro mexe em saldos, faturas, previsão e agenda: invalida tudo que é
// financeiro de uma vez (é barato num app de uma pessoa só).
const FINANCE_KEYS = ['accounts', 'transactions', 'invoices', 'budgets', 'reports', 'agenda'];
function useInvalidateFinance() {
  const client = useQueryClient();
  return () =>
    Promise.all(FINANCE_KEYS.map((key) => client.invalidateQueries({ queryKey: [key] })));
}

function searchParams(query: object) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return params;
}

// ---------------------------------------------------------------- contas

export function useAccounts(options: { archived?: boolean } = {}) {
  return useQuery({
    queryKey: ['accounts', options],
    queryFn: () =>
      api.get('accounts', { searchParams: searchParams(options) }).json<AccountResponse[]>(),
  });
}

export function useCreateAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (body: CreateAccountBody) =>
      api.post('accounts', { json: body }).json<AccountResponse>(),
    onSuccess: invalidate,
  });
}

export function useUpdateAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateAccountBody & { id: string }) =>
      api.patch(`accounts/${id}`, { json: body }).json<AccountResponse>(),
    onSuccess: invalidate,
  });
}

export function useDeleteAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (id: string) => api.delete(`accounts/${id}`),
    onSuccess: invalidate,
  });
}

export function useInvoices(accountId: string | undefined) {
  return useQuery({
    queryKey: ['invoices', accountId],
    enabled: Boolean(accountId),
    queryFn: () => api.get(`accounts/${accountId}/invoices`).json<InvoiceResponse[]>(),
  });
}

/** Faturas de todos os cartões a pagar que vencem no mês ou período. */
export function useDueInvoices(query: DueInvoicesQuery, enabled = true) {
  return useQuery({
    queryKey: ['invoices', 'due', query],
    enabled,
    queryFn: () =>
      api.get('invoices/due', { searchParams: searchParams(query) }).json<InvoiceResponse[]>(),
  });
}

export function useInvoiceTransactions(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ['invoices', 'items', invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: () => api.get(`invoices/${invoiceId}/transactions`).json<TransactionResponse[]>(),
  });
}

export function usePayInvoice() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, ...body }: PayInvoiceBody & { id: string }) =>
      api.post(`invoices/${id}/pay`, { json: body }).json<InvoiceResponse>(),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------- categorias

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get('categories').json<CategoryResponse[]>(),
    staleTime: 5 * 60_000,
  });
}

export function useCreateCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCategoryBody) =>
      api.post('categories', { json: body }).json<CategoryResponse>(),
    onSuccess: () => client.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useUpdateCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateCategoryBody & { id: string }) =>
      api.patch(`categories/${id}`, { json: body }).json<CategoryResponse>(),
    onSuccess: () => client.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useDeleteCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`categories/${id}`),
    onSuccess: () => client.invalidateQueries(),
  });
}

// ---------------------------------------------------------------- lançamentos

export function useTransactions(query: ListTransactionsQuery) {
  return useQuery({
    queryKey: ['transactions', query],
    queryFn: () =>
      api.get('transactions', { searchParams: searchParams(query) }).json<TransactionResponse[]>(),
  });
}

export function useCreateTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (body: CreateTransactionBody) =>
      api.post('transactions', { json: body }).json<TransactionResponse[]>(),
    onSuccess: invalidate,
  });
}

export function useUpdateTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<UpdateTransactionBody> & { id: string }) =>
      api.patch(`transactions/${id}`, { json: body }).json<TransactionResponse>(),
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, scope = 'single' }: { id: string; scope?: RecurrenceScope }) =>
      api.delete(`transactions/${id}`, { searchParams: { scope } }),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------- orçamentos e relatórios

export function useBudgets(month: string) {
  return useQuery({
    queryKey: ['budgets', month],
    queryFn: () => api.get('budgets', { searchParams: { month } }).json<BudgetStatusResponse[]>(),
  });
}

export function useUpsertBudget() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (body: UpsertBudgetBody) =>
      api.put('budgets', { json: body }).json<BudgetStatusResponse>(),
    onSuccess: invalidate,
  });
}

export function useCopyBudgets() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (month: string) =>
      api.post('budgets/copy-previous', { json: { month } }).json<BudgetStatusResponse[]>(),
    onSuccess: invalidate,
  });
}

export function useDeleteBudget() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (id: string) => api.delete(`budgets/${id}`),
    onSuccess: invalidate,
  });
}

export function useMonthSummary(month: string) {
  return useQuery({
    queryKey: ['reports', 'month', month],
    queryFn: () =>
      api.get('reports/month', { searchParams: { month } }).json<MonthSummaryResponse>(),
  });
}

export function useForecast(days: 30 | 90 | 365) {
  return useQuery({
    queryKey: ['reports', 'forecast', days],
    queryFn: () => api.get('reports/forecast', { searchParams: { days } }).json<ForecastResponse>(),
  });
}
