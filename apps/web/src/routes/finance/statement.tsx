import type { TransactionResponse } from '@jottape/schemas';
import { CircleX, Receipt, Search, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

import {
  activeFilterCount,
  filterTransactions,
  hasCardsAndAccounts,
  NO_FILTERS,
  type Period,
  scopeAccountIds,
  type StatementFilters,
  type StatementScope,
  totalsOf,
} from '@/components/finance/finance-utils';
import { MonthSwitcher } from '@/components/finance/month-switcher';
import { TotalsCard, TransactionList } from '@/components/finance/transaction-list';
import { Button, EmptyState, Skeleton } from '@/components/ios/controls';
import { Section } from '@/components/ios/list';
import { useAccounts, useCategories, useTransactions } from '@/features/finance';
import { capitalize, monthName, shortDay } from '@/lib/format';
import { cn } from '@/lib/utils';

import { StatementFiltersSheet } from './statement-filters-sheet';

const SCOPES: { value: StatementScope; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'accounts', label: 'Contas' },
  { value: 'cards', label: 'Cartão' },
];

/**
 * Extrato do mês ou de um período (de tudo ou de uma conta): recorte Tudo / Contas / Cartão, busca,
 * folha de filtros (tipo, previstos, período), dias e totais.
 */
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
  const [filters, setFilters] = useState<StatementFilters>(NO_FILTERS);
  const [period, setPeriod] = useState<Period | null>(null);
  const [scope, setScope] = useState<StatementScope>('all');
  const [search, setSearch] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const openSheet = () => {
    setSheetKey((key) => key + 1);
    setSheetOpen(true);
  };
  const { data: transactions, isLoading } = useTransactions(
    period ? { ...period, accountId } : { month, accountId }
  );
  const { data: accounts = [] } = useAccounts({ archived: true });
  const { data: categories = [] } = useCategories();

  // Contas e cartões só se separam no extrato geral, e só quando há os dois.
  const showScope = !accountId && hasCardsAndAccounts(accounts);
  const perspective = accountId ?? (showScope ? scopeAccountIds(accounts, scope) : undefined);

  const all = transactions ?? [];
  const inScope = filterTransactions(all, NO_FILTERS, '', perspective);
  const visible = filterTransactions(inScope, filters, search, perspective);
  const totals = totalsOf(inScope, perspective);
  const filterCount = activeFilterCount(filters, period);

  const where = period ? 'no período' : `em ${monthName(month)}`;
  const scopeLabel =
    showScope && scope !== 'all' ? ` · ${scope === 'cards' ? 'Cartão' : 'Contas'}` : '';
  const totalsTitle = `${period ? 'Resumo do período' : `Resumo de ${capitalize(monthName(month))}`}${scopeLabel}`;

  const filterButton = <FilterButton count={filterCount} onClick={openSheet} />;

  return (
    <div>
      {period ? (
        <PeriodBar period={period} onEdit={openSheet} onClear={() => setPeriod(null)} />
      ) : (
        <MonthSwitcher month={month} onChange={onMonthChange} className='-mx-2 mb-3' />
      )}

      <div className='flex items-center gap-2'>
        <div className='min-w-0 flex-1'>
          <SearchField value={search} onChange={setSearch} />
        </div>
        {!showScope && filterButton}
      </div>

      {showScope ? (
        <div className='mt-3 mb-5 flex items-center gap-2'>
          <div className='flex min-w-0 flex-1 gap-2'>
            {SCOPES.map((option) => (
              <button
                key={option.value}
                type='button'
                aria-pressed={scope === option.value}
                onClick={() => setScope(option.value)}
                className={cn(
                  'text-subhead h-8 shrink-0 rounded-full px-3.5 font-medium transition-colors active:opacity-60',
                  scope === option.value ? 'bg-tint text-white' : 'bg-surface text-foreground'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {filterButton}
        </div>
      ) : (
        <div className='h-5' />
      )}

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
                ? `Nada registrado ${where}.`
                : !inScope.length
                  ? `Nada ${scope === 'cards' ? 'no cartão' : 'nas contas'} ${where}.`
                  : 'Tente outro filtro ou outra busca.'
            }
            action={
              !all.length && !period ? (
                <Button size='md' onClick={onCreate}>
                  Novo lançamento
                </Button>
              ) : filterCount > 0 ? (
                <Button
                  size='md'
                  variant='tinted'
                  onClick={() => {
                    setFilters(NO_FILTERS);
                    setPeriod(null);
                  }}
                >
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        </Section>
      )}

      {!isLoading && inScope.length > 0 && <TotalsCard totals={totals} title={totalsTitle} />}

      <StatementFiltersSheet
        key={sheetKey}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        filters={filters}
        period={period}
        month={month}
        onApply={(nextFilters, nextPeriod) => {
          setFilters(nextFilters);
          setPeriod(nextPeriod);
          setSheetOpen(false);
        }}
      />
    </div>
  );
}

/** Botão de filtros ao lado dos chips; com filtro ligado fica preenchido e mostra quantos. */
function FilterButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={count ? `Filtros (${count} ligados)` : 'Filtros'}
      className={cn(
        'relative flex size-9 shrink-0 items-center justify-center rounded-full transition-colors active:opacity-60',
        count ? 'bg-tint text-white' : 'bg-surface text-tint'
      )}
    >
      <SlidersHorizontal className='size-[18px]' strokeWidth={2.25} />
      {count > 0 && (
        <span className='bg-red text-caption-2 ring-background absolute -top-1 -right-1 flex size-[18px] items-center justify-center rounded-full font-semibold text-white ring-2'>
          {count}
        </span>
      )}
    </button>
  );
}

/** No lugar do "‹ Mês ›" quando há período: as datas, tocar edita, "Limpar" volta para o mês. */
function PeriodBar({
  period,
  onEdit,
  onClear,
}: {
  period: Period;
  onEdit: () => void;
  onClear: () => void;
}) {
  return (
    <div className='mb-3 flex min-h-11 items-center justify-between gap-2'>
      <button type='button' onClick={onEdit} className='min-w-0 text-left active:opacity-60'>
        <div className='text-caption text-label-2 font-medium uppercase'>Período</div>
        <div className='text-headline truncate'>{periodLabel(period)}</div>
      </button>
      <button
        type='button'
        onClick={onClear}
        className='text-tint text-subhead shrink-0 font-medium active:opacity-40'
      >
        Voltar ao mês
      </button>
    </div>
  );
}

/** "1 de out. – 15 de out." (com o ano quando muda de um lado para o outro). */
export function periodLabel({ from, to }: Period) {
  if (from === to) return shortDay(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const side = (day: string) => (sameYear ? shortDay(day) : `${shortDay(day)} ${day.slice(0, 4)}`);
  return `${side(from)} – ${side(to)}`;
}

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
