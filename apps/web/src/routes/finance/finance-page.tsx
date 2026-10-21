import type { TransactionResponse } from '@jottape/schemas';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Inbox, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { AccountChip, AddAccountChip } from '@/components/finance/account-card';
import { AccountSheet } from '@/components/finance/account-sheet';
import {
  availableBalance,
  forecastAt,
  lastDayOfMonth,
  monthOfDay,
  resolveMonth,
} from '@/components/finance/finance-utils';
import { TransactionSheet } from '@/components/finance/transaction-sheet';
import { useSheetState } from '@/components/finance/use-sheet-state';
import { Segmented, Skeleton } from '@/components/ios/controls';
import { BarButton } from '@/components/ios/page';
import { useBankStatus } from '@/features/bank';
import { useAccounts, useForecast } from '@/features/finance';
import { money, todayKey } from '@/lib/format';
import { cn } from '@/lib/utils';

import { BudgetsTab } from './budgets-tab';
import { ForecastTab } from './forecast-tab';
import { Statement } from './statement';
import { SummaryTab } from './summary-tab';

type Tab = 'extrato' | 'previsao' | 'resumo' | 'orcamentos';
const TABS: { value: Tab; label: string }[] = [
  { value: 'extrato', label: 'Extrato' },
  { value: 'previsao', label: 'Previsão' },
  { value: 'resumo', label: 'Resumo' },
  { value: 'orcamentos', label: 'Orçamentos' },
];
const isTab = (value: unknown): value is Tab => TABS.some((t) => t.value === value);

export function FinancePage() {
  const search = useSearch({ from: '/app/financas' });
  const navigate = useNavigate({ from: '/financas' });
  const today = todayKey();
  const tab: Tab = isTab(search.tab) ? search.tab : 'extrato';
  const month = resolveMonth(search.month, today);

  const txSheet = useSheetState<TransactionResponse>();
  const accountSheet = useSheetState<undefined>();

  const setSearch = (next: { tab?: Tab; month?: string }) =>
    void navigate({
      search: (prev: { tab?: string; month?: string }) => ({
        ...prev,
        ...next,
        // Mês atual não precisa ficar na URL.
        ...(next.month !== undefined
          ? { month: next.month === monthOfDay(today) ? undefined : next.month }
          : {}),
        ...(next.tab !== undefined ? { tab: next.tab === 'extrato' ? undefined : next.tab } : {}),
      }),
      replace: true,
    });

  const onMonthChange = (value: string) => setSearch({ month: value });

  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  // Trocar de aba volta a lista para o topo.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [tab]);

  return (
    // Saldo, contas e abas ficam presos no topo; só o conteúdo da aba rola.
    <div className='flex h-dvh flex-col'>
      <header
        className={cn(
          'pt-safe shrink-0 transition-shadow duration-200',
          scrolled && 'shadow-[inset_0_-0.5px_0_var(--separator)]'
        )}
      >
        <div className='mx-auto max-w-3xl px-4 lg:px-8'>
          <div className='flex h-12 items-center justify-between'>
            <h1 className='text-title-1 font-bold'>Finanças</h1>
            <BarButton label='Novo lançamento' onClick={() => txSheet.show(undefined)}>
              <Plus strokeWidth={2.25} />
            </BarButton>
          </div>
          <Hero />
          <Wallet onAddAccount={() => accountSheet.show(undefined)} />
          <ReviewBanner />
          <Segmented
            value={tab}
            onChange={(value) => setSearch({ tab: value })}
            options={TABS}
            className='mb-3'
          />
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
        className='min-h-0 flex-1 overflow-y-auto overscroll-contain'
      >
        <div className='mx-auto max-w-3xl px-4 pt-2 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-12'>
          {tab === 'extrato' && (
            <Statement
              month={month}
              onMonthChange={onMonthChange}
              onSelect={(tx) => txSheet.show(tx)}
              onCreate={() => txSheet.show(undefined)}
            />
          )}
          {tab === 'previsao' && <ForecastTab onSelect={(tx) => txSheet.show(tx)} />}
          {tab === 'resumo' && <SummaryTab month={month} onMonthChange={onMonthChange} />}
          {tab === 'orcamentos' && <BudgetsTab month={month} onMonthChange={onMonthChange} />}
        </div>
      </div>

      <TransactionSheet
        open={txSheet.open}
        onOpenChange={txSheet.onOpenChange}
        transaction={txSheet.value}
        defaults={
          !txSheet.value && tab === 'extrato' && month !== monthOfDay(today)
            ? { date: `${month}-01` }
            : undefined
        }
      />
      <AccountSheet open={accountSheet.open} onOpenChange={accountSheet.onOpenChange} />
    </div>
  );
}

/** Lançamentos do banco esperando revisão (Meu Pluggy). Some quando não há nenhum. */
function ReviewBanner() {
  const pending = useBankStatus().data?.pendingCount ?? 0;
  if (!pending) return null;
  return (
    <Link
      to='/financas/revisar'
      className='bg-green/15 text-green text-subhead mb-3 flex items-center gap-2 rounded-[12px] px-3 py-2 font-semibold active:opacity-60'
    >
      <Inbox className='size-[18px]' />
      {pending === 1 ? '1 lançamento do banco' : `${pending} lançamentos do banco`} para revisar
    </Link>
  );
}

/** Saldo disponível numa linha, com a previsão do fim do mês ao lado. */
function Hero() {
  const { data: accounts, isLoading } = useAccounts();
  const { data: forecast } = useForecast(30);
  const today = todayKey();
  const balance = availableBalance(accounts ?? []);
  const endOfMonth = forecastAt(forecast, lastDayOfMonth(monthOfDay(today)));
  const signed = (cents: number) => (cents < 0 ? `−${money(-cents)}` : money(cents));

  return (
    <div className='mb-3 flex items-end justify-between gap-4'>
      <div className='min-w-0'>
        <div className='text-footnote text-label-2 font-medium'>Saldo disponível</div>
        {isLoading ? (
          <Skeleton className='my-1 h-7 w-40' />
        ) : (
          <div
            className={cn(
              'font-rounded numeric truncate text-[28px] leading-[34px] font-bold tracking-tight',
              balance < 0 && 'text-red'
            )}
          >
            {signed(balance)}
          </div>
        )}
      </div>
      {endOfMonth && (
        <div className='shrink-0 pb-0.5 text-right'>
          <div className='text-footnote text-label-2'>Fim do mês</div>
          <div
            className={cn(
              'font-rounded numeric text-callout font-semibold',
              endOfMonth.totalCents < 0 && 'text-red'
            )}
          >
            {signed(endOfMonth.totalCents)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Faixa de contas em cartões pequenos, com o "+" no fim. */
function Wallet({ onAddAccount }: { onAddAccount: () => void }) {
  const { data: accounts, isLoading } = useAccounts();
  const navigate = useNavigate();
  const visible = (accounts ?? []).filter((a) => !a.archived);

  return (
    <div
      className='no-scrollbar -mx-4 mb-3 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 lg:-mx-8 lg:scroll-px-8 lg:px-8'
      aria-label='Contas'
    >
      {isLoading
        ? [0, 1].map((i) => (
            <Skeleton key={i} className='h-[58px] w-[148px] shrink-0 rounded-[12px]' />
          ))
        : visible.map((account) => (
            <AccountChip
              key={account.id}
              account={account}
              onClick={() =>
                void navigate({
                  to: '/financas/contas/$accountId',
                  params: { accountId: account.id },
                })
              }
            />
          ))}
      {!isLoading && <AddAccountChip onClick={onAddAccount} />}
    </div>
  );
}
