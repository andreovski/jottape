import type { TransactionResponse } from '@jottape/schemas';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronRight, Inbox, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { AccountSheet } from '@/components/finance/account-sheet';
import { AccountsSheet, AccountsStackIcon } from '@/components/finance/accounts-sheet';
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
import { SettingsButton } from '@/components/settings-button';
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
  const summary = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const accountsSheet = useSheetState<undefined>();
  // Trocar de aba volta a lista para o topo.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [tab]);

  // O topo grande rola junto com a lista, como o título grande do iOS; a barra pequena aparece
  // quando as abas encostam nela. Só muda a opacidade da barra: nada muda de tamanho na rolagem,
  // então não há salto nem vai e volta com listas curtas.
  const onScroll = (element: HTMLDivElement) => {
    const barBottom = (bar.current?.offsetTop ?? 0) + (bar.current?.offsetHeight ?? 0);
    const limit = (summary.current?.offsetHeight ?? 0) - barBottom;
    setCompact(element.scrollTop >= Math.max(limit, 1));
  };

  const openAccounts = () => accountsSheet.show(undefined);
  const addAccount = () => accountSheet.show(undefined);
  const addTransaction = () => txSheet.show(undefined);

  return (
    <div className='relative h-dvh'>
      <CompactBar
        ref={bar}
        visible={compact}
        onAdd={addTransaction}
        onAccounts={openAccounts}
        onAddAccount={addAccount}
      />

      <div
        ref={scroller}
        onScroll={(event) => onScroll(event.currentTarget)}
        className='h-full overflow-y-auto overscroll-contain'
      >
        <div ref={summary} className='pt-safe mx-auto max-w-3xl px-4 lg:px-8'>
          <Summary onAdd={addTransaction} onAccounts={openAccounts} onAddAccount={addAccount} />
          <ReviewBanner />
        </div>

        {/* As abas ficam presas logo abaixo da barra pequena. */}
        <div
          className={cn(
            'bg-background sticky top-[calc(env(safe-area-inset-top)+52px)] z-10 transition-shadow duration-200',
            compact && 'shadow-[inset_0_-0.5px_0_var(--separator)]'
          )}
        >
          <div className='mx-auto max-w-3xl px-4 pb-3 lg:px-8'>
            <Segmented value={tab} onChange={(value) => setSearch({ tab: value })} options={TABS} />
          </div>
        </div>

        <div className='mx-auto max-w-3xl px-4 pt-2 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-12'>
          {tab === 'extrato' && (
            <Statement
              month={month}
              onMonthChange={onMonthChange}
              onSelect={(tx) => txSheet.show(tx)}
              onCreate={addTransaction}
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
      <FinanceAccountsSheet
        open={accountsSheet.open}
        onOpenChange={accountsSheet.onOpenChange}
        onAddAccount={() => {
          accountsSheet.onOpenChange(false);
          accountSheet.show(undefined);
        }}
      />
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
      className='bg-surface mb-3 flex items-center gap-3 rounded-[var(--radius)] px-3 py-2.5 active:opacity-60'
    >
      <span className='bg-green/15 text-green flex size-10 shrink-0 items-center justify-center rounded-[11px]'>
        <Inbox className='size-5' />
      </span>
      <span className='min-w-0 flex-1'>
        <span className='text-subhead block font-semibold'>
          {pending === 1 ? '1 lançamento do banco' : `${pending} lançamentos do banco`} para revisar
        </span>
        <span className='text-footnote text-label-2 block'>Confira e importe para o saldo.</span>
      </span>
      <span className='bg-green text-subhead shrink-0 rounded-full px-3 py-1 font-semibold text-white'>
        Revisar
      </span>
    </Link>
  );
}

/** Saldo disponível, previsão do fim do mês e contas (só quando não é cartão nem arquivada). */
function useTotals() {
  const { data: accounts, isLoading } = useAccounts();
  const { data: forecast } = useForecast(30);
  const visible = (accounts ?? []).filter((a) => !a.archived);
  const endOfMonth = forecastAt(forecast, lastDayOfMonth(monthOfDay(todayKey())));
  return {
    isLoading,
    accounts: visible,
    balance: availableBalance(accounts ?? []),
    endOfMonth: endOfMonth?.totalCents,
  };
}

const signed = (cents: number) => (cents < 0 ? `−${money(-cents)}` : money(cents));

/** Saldo em destaque; menor na barra recolhida. */
function Balance({ compact }: { compact?: boolean }) {
  const { isLoading, balance } = useTotals();
  if (isLoading) return <Skeleton className={cn('my-1 w-36', compact ? 'h-5' : 'h-8')} />;
  return (
    <div
      className={cn(
        'font-rounded numeric truncate font-bold tracking-tight',
        compact ? 'text-[21px] leading-[26px]' : 'text-[32px] leading-[38px]',
        balance < 0 && 'text-red'
      )}
    >
      {signed(balance)}
    </div>
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Topo das Finanças (rola com a lista): título, saldo grande com o fim do mês embaixo e, ao lado,
 * o botão das contas com mini cartões empilhados, como o Wallet.
 */
function Summary({
  onAdd,
  onAccounts,
  onAddAccount,
}: {
  onAdd: () => void;
  onAccounts: () => void;
  onAddAccount: () => void;
}) {
  const { isLoading, accounts, endOfMonth } = useTotals();
  const cards = accounts.filter((a) => a.type === 'CREDIT_CARD').length;
  const others = accounts.length - cards;

  return (
    <div>
      <div className='flex h-12 items-center justify-between'>
        <h1 className='text-title-1 font-bold'>Finanças</h1>
        {/* Só no topo: a barra recolhida já está cheia (saldo, contas e "+"). */}
        <div className='flex items-center gap-1'>
          <SettingsButton />
          <BarButton label='Novo lançamento' onClick={onAdd}>
            <Plus strokeWidth={2.25} />
          </BarButton>
        </div>
      </div>
      <div className='mb-3 flex items-end justify-between gap-3'>
        <div className='min-w-0'>
          <div className='text-footnote text-label-2 font-medium'>Saldo disponível</div>
          <Balance />
          {endOfMonth !== undefined && (
            <div className='text-footnote text-label-2 truncate'>
              Fim do mês{' '}
              <span
                className={cn(
                  'font-rounded numeric text-foreground font-semibold',
                  endOfMonth < 0 && 'text-red'
                )}
              >
                {signed(endOfMonth)}
              </span>
            </div>
          )}
        </div>
        <button
          type='button'
          onClick={accounts.length ? onAccounts : onAddAccount}
          className='bg-surface mb-0.5 flex h-11 shrink-0 items-center gap-2 rounded-full pr-2.5 pl-2 text-left shadow-[0_1px_2px_rgb(0_0_0/0.06)] transition-transform duration-150 active:scale-[0.96] dark:shadow-none'
        >
          {isLoading ? (
            <Skeleton className='h-[22px] w-[34px] rounded-[5px]' />
          ) : accounts.length ? (
            <AccountsStackIcon accounts={accounts} />
          ) : (
            <span className='text-tint flex h-[30px] w-[30px] items-center justify-center'>
              <Plus className='size-5' strokeWidth={2.5} />
            </span>
          )}
          <span className='text-footnote leading-tight'>
            <span className='block font-semibold'>
              {accounts.length
                ? others
                  ? plural(others, 'conta', 'contas')
                  : plural(cards, 'cartão', 'cartões')
                : 'Adicionar'}
            </span>
            <span className='text-label-2 block'>
              {accounts.length
                ? others && cards
                  ? plural(cards, 'cartão', 'cartões')
                  : 'ver todas'
                : 'conta'}
            </span>
          </span>
          <ChevronRight className='text-label-3 size-4' strokeWidth={2.75} />
        </button>
      </div>
    </div>
  );
}

/**
 * Barra fixa que aparece quando o topo grande sai da tela: saldo menor, pílula das contas e "+".
 * A faixa do relógio fica sempre coberta, para a lista não passar por baixo dele.
 */
function CompactBar({
  ref,
  visible,
  onAdd,
  onAccounts,
  onAddAccount,
}: {
  ref: React.Ref<HTMLDivElement>;
  visible: boolean;
  onAdd: () => void;
  onAccounts: () => void;
  onAddAccount: () => void;
}) {
  const { accounts } = useTotals();
  return (
    <div className='pointer-events-none absolute inset-x-0 top-0 z-20'>
      <div className='bg-background h-[env(safe-area-inset-top)]' />
      <div
        ref={ref}
        aria-hidden={!visible}
        inert={!visible}
        className={cn(
          'bg-background transition-[opacity,transform] duration-200 ease-out',
          visible ? 'pointer-events-auto opacity-100' : '-translate-y-1 opacity-0'
        )}
      >
        <div className='mx-auto flex h-[52px] max-w-3xl items-center gap-2.5 px-4 lg:px-8'>
          <div className='min-w-0 flex-1'>
            <div className='text-caption-2 text-label-2 font-medium'>Saldo disponível</div>
            <Balance compact />
          </div>
          <button
            type='button'
            onClick={accounts.length ? onAccounts : onAddAccount}
            aria-label='Contas'
            className='bg-fill text-subhead flex h-8 shrink-0 items-center gap-1.5 rounded-full pr-2 pl-1.5 font-semibold active:opacity-60'
          >
            {accounts.length ? (
              <>
                <AccountsStackIcon accounts={accounts} size='sm' />
                {accounts.length}
              </>
            ) : (
              <Plus className='text-tint size-4' strokeWidth={2.5} />
            )}
            <ChevronRight className='text-label-3 size-3.5' strokeWidth={3} />
          </button>
          <BarButton label='Novo lançamento' onClick={onAdd} className='size-8 [&_svg]:size-[18px]'>
            <Plus strokeWidth={2.25} />
          </BarButton>
        </div>
      </div>
    </div>
  );
}

/** Folha com a carteira completa, alimentada pelos mesmos totais do topo. */
function FinanceAccountsSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddAccount: () => void;
}) {
  const { accounts, balance, endOfMonth } = useTotals();
  return (
    <AccountsSheet
      {...props}
      accounts={accounts}
      balanceCents={balance}
      endOfMonthCents={endOfMonth}
    />
  );
}
