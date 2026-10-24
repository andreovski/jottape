import type { TransactionResponse } from '@jottape/schemas';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ChevronLeft, Receipt, Tag } from 'lucide-react';

import { CategoryIcon } from '@/components/finance/category-icon';
import {
  categoryExpenses,
  categoryLabel,
  expenseTotalsByCategory,
  hasCardsAndAccounts,
  monthOfDay,
  NO_CATEGORY,
  percentLabel,
  resolveMonth,
  scopeAccountIds,
  type StatementScope,
} from '@/components/finance/finance-utils';
import { MonthSwitcher } from '@/components/finance/month-switcher';
import { resolveScope, ScopeFilter } from '@/components/finance/scope-filter';
import { TransactionList } from '@/components/finance/transaction-list';
import { TransactionSheet } from '@/components/finance/transaction-sheet';
import { useSheetState } from '@/components/finance/use-sheet-state';
import { Button, EmptyState, Skeleton } from '@/components/ios/controls';
import { Section } from '@/components/ios/list';
import { Page } from '@/components/ios/page';
import { useAccounts, useCategories, useTransactions } from '@/features/finance';
import { money, monthName, todayKey } from '@/lib/format';

import { StatementSkeleton } from './statement';

/**
 * Despesas pagas de uma categoria no mês, as mesmas que formam a fatia do Resumo, com o mesmo
 * recorte Tudo / Contas / Cartão. Tocar num lançamento abre a folha de edição.
 */
export function CategoryPage() {
  const { categoryId: param } = useParams({ from: '/app/financas/categorias/$categoryId' });
  const search = useSearch({ from: '/app/financas/categorias/$categoryId' });
  const navigate = useNavigate({ from: '/financas/categorias/$categoryId' });
  const today = todayKey();
  const month = resolveMonth(search.month, today);
  const scope = resolveScope(search.scope);
  const categoryId = param === NO_CATEGORY ? null : param;

  const { data: categories = [], isLoading: loadingCategories } = useCategories();
  const { data: accounts = [] } = useAccounts({ archived: true });
  const { data: transactions, isLoading } = useTransactions({ month });
  const txSheet = useSheetState<TransactionResponse>();

  const category = categoryId ? categories.find((c) => c.id === categoryId) : null;
  const title = category
    ? categoryLabel(category, categories)
    : categoryId
      ? 'Categoria'
      : 'Sem categoria';

  const showScope = hasCardsAndAccounts(accounts);
  const effective = showScope ? scope : 'all';
  const accountIds = scopeAccountIds(accounts, effective);
  const items = categoryExpenses(transactions ?? [], categoryId, accountIds);
  const totalCents = items.reduce((total, tx) => total + tx.amountCents, 0);
  const monthCents = expenseTotalsByCategory(transactions ?? [], accountIds).reduce(
    (total, slice) => total + slice.totalCents,
    0
  );

  const setSearch = (next: { month?: string; scope?: StatementScope }) =>
    void navigate({
      search: (prev: { month?: string; scope?: string }) => ({
        ...prev,
        ...(next.month !== undefined
          ? { month: next.month === monthOfDay(today) ? undefined : next.month }
          : {}),
        ...(next.scope !== undefined
          ? { scope: next.scope === 'all' ? undefined : next.scope }
          : {}),
      }),
      replace: true,
    });

  // Volta para o Resumo no mesmo mês e recorte.
  const back = () =>
    void navigate({
      to: '/financas',
      search: {
        tab: 'resumo',
        month: month === monthOfDay(today) ? undefined : month,
        scope: effective === 'all' ? undefined : effective,
      },
    });

  const leading = (
    <button
      type='button'
      onClick={back}
      className='text-tint text-body -ml-2 flex items-center active:opacity-40'
    >
      <ChevronLeft className='size-7' strokeWidth={2.25} />
      Resumo
    </button>
  );

  if (categoryId && !category && !loadingCategories) {
    return (
      <Page title='Categoria' leading={leading}>
        <EmptyState
          icon={<Tag />}
          title='Categoria não encontrada'
          message='Ela pode ter sido apagada.'
          action={
            <Button size='md' onClick={back}>
              Voltar para o Resumo
            </Button>
          }
        />
      </Page>
    );
  }

  const where = `em ${monthName(month)}`;
  const share = monthCents ? (totalCents / monthCents) * 100 : 0;

  return (
    <Page title={title} leading={leading}>
      <MonthSwitcher
        month={month}
        onChange={(value) => setSearch({ month: value })}
        className='-mx-2 mb-4'
      />

      <div className='bg-surface mb-7 flex items-center gap-3.5 rounded-[var(--radius)] p-4'>
        <CategoryIcon category={category} size='lg' />
        <div className='min-w-0 flex-1'>
          <div className='text-footnote text-label-2 font-medium'>Despesas pagas</div>
          {isLoading ? (
            <Skeleton className='my-1 h-7 w-32' />
          ) : (
            <div className='font-rounded numeric text-red truncate text-[28px] leading-tight font-semibold tracking-tight'>
              {money(totalCents)}
            </div>
          )}
          <div className='text-footnote text-label-2 min-h-[18px] truncate'>
            {isLoading
              ? ' '
              : items.length
                ? `${items.length === 1 ? '1 lançamento' : `${items.length} lançamentos`} · ${percentLabel(share)} do total`
                : ' '}
          </div>
        </div>
        {showScope && (
          <div className='self-start'>
            <ScopeFilter
              scope={scope}
              onChange={(value) => setSearch({ scope: value })}
              onSurface
            />
          </div>
        )}
      </div>

      {isLoading ? (
        <StatementSkeleton />
      ) : items.length ? (
        <TransactionList
          transactions={items}
          accounts={accounts}
          categories={categories}
          accountId={accountIds}
          onSelect={(tx) => txSheet.show(tx)}
        />
      ) : (
        <Section>
          <EmptyState
            icon={<Receipt />}
            title='Nenhuma despesa'
            message={
              effective === 'all'
                ? `Nada pago nesta categoria ${where}.`
                : `Nada pago ${effective === 'cards' ? 'no cartão' : 'nas contas'} nesta categoria ${where}.`
            }
          />
        </Section>
      )}

      <TransactionSheet
        open={txSheet.open}
        onOpenChange={txSheet.onOpenChange}
        transaction={txSheet.value}
      />
    </Page>
  );
}
