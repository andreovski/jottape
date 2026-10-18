import type { TransactionResponse } from '@jottape/schemas';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';

import { AccountCard, AddAccountCard } from '@/components/finance/account-card';
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
import { BarButton, Page } from '@/components/ios/page';
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
  const search = useSearch({ from: '/financas' });
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

  return (
    <Page
      title='Finanças'
      actions={
        <BarButton label='Novo lançamento' onClick={() => txSheet.show(undefined)}>
          <Plus strokeWidth={2.25} />
        </BarButton>
      }
    >
      <Hero />
      <Wallet onAddAccount={() => accountSheet.show(undefined)} />

      <Segmented
        value={tab}
        onChange={(value) => setSearch({ tab: value })}
        options={TABS}
        className='mb-5'
      />

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
    </Page>
  );
}

/** "Saldo disponível" grande, como o Apple Cash, e a previsão para o fim do mês. */
function Hero() {
  const { data: accounts, isLoading } = useAccounts();
  const { data: forecast } = useForecast(30);
  const today = todayKey();
  const balance = availableBalance(accounts ?? []);
  const endOfMonth = forecastAt(forecast, lastDayOfMonth(monthOfDay(today)));

  return (
    <div className='mb-5 px-1'>
      <div className='text-footnote text-label-2 font-medium'>Saldo disponível</div>
      {isLoading ? (
        <Skeleton className='my-1.5 h-11 w-52' />
      ) : (
        <div
          className={cn(
            'font-rounded numeric text-[44px] leading-[52px] font-bold tracking-tight sm:text-[52px] sm:leading-[60px]',
            balance < 0 && 'text-red'
          )}
        >
          {balance < 0 ? `−${money(-balance)}` : money(balance)}
        </div>
      )}
      {endOfMonth && (
        <div className='text-subhead text-label-2'>
          Previsto no fim do mês:{' '}
          <span
            className={cn(
              'font-rounded numeric font-semibold',
              endOfMonth.totalCents < 0 ? 'text-red' : 'text-foreground'
            )}
          >
            {endOfMonth.totalCents < 0
              ? `−${money(-endOfMonth.totalCents)}`
              : money(endOfMonth.totalCents)}
          </span>
        </div>
      )}
    </div>
  );
}

/** Carrossel de cartões do Wallet, com o "Adicionar conta" no fim. */
function Wallet({ onAddAccount }: { onAddAccount: () => void }) {
  const { data: accounts, isLoading } = useAccounts();
  const navigate = useNavigate();
  const visible = (accounts ?? []).filter((a) => !a.archived);
  const item = 'w-[78%] max-w-[300px] shrink-0 snap-start sm:w-[280px]';

  return (
    <div
      className='no-scrollbar -mx-4 mb-6 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-4 lg:-mx-8 lg:scroll-px-8 lg:px-8'
      aria-label='Contas'
    >
      {isLoading
        ? [0, 1].map((i) => (
            <Skeleton key={i} className={cn(item, 'aspect-[1.586] rounded-[16px]')} />
          ))
        : visible.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              className={item}
              onClick={() =>
                void navigate({
                  to: '/financas/contas/$accountId',
                  params: { accountId: account.id },
                })
              }
            />
          ))}
      {!isLoading && <AddAccountCard onClick={onAddAccount} className={item} />}
    </div>
  );
}
