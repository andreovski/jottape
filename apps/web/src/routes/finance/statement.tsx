import type { TransactionResponse } from '@jottape/schemas';
import { CircleX, Receipt, Search } from 'lucide-react';
import { useState } from 'react';

import {
  filterTransactions,
  hasCardsAndAccounts,
  scopeAccountIds,
  type StatementFilter,
  type StatementScope,
  totalsOf,
} from '@/components/finance/finance-utils';
import { MonthSwitcher } from '@/components/finance/month-switcher';
import { TotalsCard, TransactionList } from '@/components/finance/transaction-list';
import { Button, EmptyState, Segmented, Skeleton } from '@/components/ios/controls';
import { Section } from '@/components/ios/list';
import { useAccounts, useCategories, useTransactions } from '@/features/finance';
import { capitalize, monthName } from '@/lib/format';
import { cn } from '@/lib/utils';

const FILTERS: { value: StatementFilter; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'income', label: 'Entradas' },
  { value: 'expense', label: 'Saídas' },
  { value: 'planned', label: 'Previstos' },
];

const SCOPES: { value: StatementScope; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'accounts', label: 'Contas' },
  { value: 'cards', label: 'Cartões' },
];

/** Extrato do mês (de tudo ou de uma conta): mês, filtros, busca, dias e totais. */
export function Statement({
  month,
  onMonthChange,
  accountId,
  onSelect,
  onCreate,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  accountId?: string;
  onSelect: (transaction: TransactionResponse) => void;
  onCreate: () => void;
}) {
  const [filter, setFilter] = useState<StatementFilter>('all');
  const [scope, setScope] = useState<StatementScope>('all');
  const [search, setSearch] = useState('');
  const { data: transactions, isLoading } = useTransactions({ month, accountId });
  const { data: accounts = [] } = useAccounts({ archived: true });
  const { data: categories = [] } = useCategories();

  // Contas e cartões só se separam no extrato geral, e só quando há os dois.
  const showScope = !accountId && hasCardsAndAccounts(accounts);
  const perspective = accountId ?? (showScope ? scopeAccountIds(accounts, scope) : undefined);

  const all = transactions ?? [];
  const inScope = filterTransactions(all, 'all', '', perspective);
  const visible = filterTransactions(inScope, filter, search, perspective);
  const totals = totalsOf(inScope, perspective);
  const scopeLabel = showScope && scope !== 'all' ? ` · ${scopeLabelOf(scope)}` : '';

  return (
    <div>
      <MonthSwitcher month={month} onChange={onMonthChange} className='-mx-2 mb-3' />

      {showScope && (
        <Segmented value={scope} onChange={setScope} options={SCOPES} className='mb-3' />
      )}

      <SearchField value={search} onChange={setSearch} />

      <div className='no-scrollbar -mx-4 mt-3 mb-5 flex gap-2 overflow-x-auto px-4'>
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type='button'
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={cn(
              'text-subhead h-8 shrink-0 rounded-full px-3.5 font-medium transition-colors active:opacity-60',
              filter === option.value ? 'bg-tint text-white' : 'bg-surface text-foreground'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <StatementSkeleton />
      ) : visible.length ? (
        <TransactionList
          transactions={visible}
          accounts={accounts}
          categories={categories}
          accountId={perspective}
          onSelect={onSelect}
        />
      ) : (
        <Section>
          <EmptyState
            icon={<Receipt />}
            title={all.length ? 'Nada encontrado' : 'Nenhum lançamento'}
            message={
              !all.length
                ? `Nada registrado em ${monthName(month)}.`
                : !inScope.length
                  ? `Nada ${scope === 'cards' ? 'nos cartões' : 'nas contas'} em ${monthName(month)}.`
                  : 'Tente outro filtro ou outra busca.'
            }
            action={
              !all.length && (
                <Button size='md' onClick={onCreate}>
                  Novo lançamento
                </Button>
              )
            }
          />
        </Section>
      )}

      {!isLoading && inScope.length > 0 && (
        <TotalsCard
          totals={totals}
          title={`Resumo de ${capitalize(monthName(month))}${scopeLabel}`}
        />
      )}
    </div>
  );
}

const scopeLabelOf = (scope: StatementScope) =>
  SCOPES.find((option) => option.value === scope)?.label ?? '';

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className='bg-fill flex h-9 items-center gap-1.5 rounded-[10px] px-2'>
      <Search className='text-label-2 size-[18px] shrink-0' strokeWidth={2.25} />
      <input
        type='search'
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder='Buscar'
        aria-label='Buscar lançamentos'
        className='text-body placeholder:text-label-2 min-w-0 flex-1 bg-transparent outline-none [&::-webkit-search-cancel-button]:hidden'
      />
      {value && (
        <button
          type='button'
          aria-label='Limpar busca'
          onClick={() => onChange('')}
          className='text-label-3 flex size-7 items-center justify-center active:opacity-50'
        >
          <CircleX className='size-[19px]' fill='var(--label-3)' color='var(--surface)' />
        </button>
      )}
    </div>
  );
}

export function StatementSkeleton() {
  return (
    <div className='space-y-5'>
      {[3, 2].map((rows, i) => (
        <div key={i}>
          <Skeleton className='mb-2 ml-4 h-3 w-24' />
          <div className='bg-surface space-y-0 overflow-hidden rounded-[var(--radius)]'>
            {Array.from({ length: rows }).map((_, j) => (
              <div key={j} className='flex items-center gap-3 px-4 py-3'>
                <Skeleton className='size-[29px] rounded-full' />
                <div className='flex-1 space-y-1.5'>
                  <Skeleton className='h-3.5 w-2/5' />
                  <Skeleton className='h-3 w-1/4' />
                </div>
                <Skeleton className='h-4 w-16' />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
