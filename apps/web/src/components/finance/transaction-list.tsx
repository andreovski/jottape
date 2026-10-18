import type { AccountResponse, CategoryResponse, TransactionResponse } from '@jottape/schemas';
import { Clock, Repeat } from 'lucide-react';

import { Section } from '@/components/ios/list';
import { useUpdateTransaction } from '@/features/finance';
import { money, relativeDay, signedMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

import { CategoryIcon } from './category-icon';
import { groupByDay, installmentLabel, signedAmount, type Totals } from './finance-utils';

interface ListProps {
  transactions: TransactionResponse[];
  accounts: AccountResponse[];
  categories: CategoryResponse[];
  /** Extrato de uma conta: transferências ganham sinal. */
  accountId?: string;
  onSelect: (transaction: TransactionResponse) => void;
}

/** Extrato agrupado por dia (uma seção por dia, a mais recente primeiro). */
export function TransactionList({
  transactions,
  accounts,
  categories,
  accountId,
  onSelect,
}: ListProps) {
  const groups = groupByDay(transactions, accountId);
  return (
    <>
      {groups.map((group) => (
        <Section
          key={group.date}
          header={relativeDay(group.date)}
          action={
            group.totalCents !== 0 ? (
              <span className='text-footnote text-label-2 font-rounded numeric'>
                {signedMoney(group.totalCents)}
              </span>
            ) : undefined
          }
          className='mb-5'
        >
          {group.items.map((tx) => (
            <TransactionRow
              key={tx.id}
              transaction={tx}
              accounts={accounts}
              categories={categories}
              accountId={accountId}
              onClick={() => onSelect(tx)}
            />
          ))}
        </Section>
      ))}
    </>
  );
}

export function TransactionRow({
  transaction: tx,
  accounts,
  categories,
  accountId,
  onClick,
  showDate,
}: {
  transaction: TransactionResponse;
  accounts: AccountResponse[];
  categories: CategoryResponse[];
  accountId?: string;
  onClick: () => void;
  /** Mostra o dia no subtítulo (listas que não são agrupadas por dia). */
  showDate?: boolean;
}) {
  const update = useUpdateTransaction();
  const category = categories.find((c) => c.id === tx.categoryId) ?? null;
  const account = accounts.find((a) => a.id === tx.accountId);
  const destination = accounts.find((a) => a.id === tx.toAccountId);
  const planned = tx.status === 'PLANNED';
  const installment = installmentLabel(tx);

  const subtitleParts = [
    showDate ? relativeDay(tx.date) : null,
    tx.kind === 'TRANSFER'
      ? `${account?.name ?? 'Conta'} → ${destination?.name ?? 'Conta'}`
      : (account?.name ?? null),
    installment,
  ].filter(Boolean);

  const signed = signedAmount(tx, accountId);
  const amountText =
    tx.kind === 'TRANSFER' && !accountId
      ? money(tx.amountCents)
      : signed > 0
        ? `+ ${money(signed)}`
        : `− ${money(-signed)}`;

  const amountColor = planned
    ? 'text-label-2'
    : tx.kind === 'TRANSFER'
      ? accountId && signed > 0
        ? 'text-green'
        : 'text-label-2'
      : signed > 0
        ? 'text-green'
        : 'text-foreground';

  const actionLabel =
    tx.kind === 'INCOME' ? 'Receber' : tx.kind === 'TRANSFER' ? 'Efetivar' : 'Pagar';

  return (
    // Div com role de botão: a linha tem o botão "Pagar" dentro, e botão dentro de botão não vale.
    <div
      role='button'
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className='group/row active:bg-fill flex w-full cursor-pointer items-center gap-3 pl-4 text-left transition-colors duration-75 outline-none focus-visible:bg-fill'
    >
      <div className='flex shrink-0 items-center py-2'>
        <CategoryIcon category={category} kind={tx.kind} />
      </div>
      <div className='flex min-h-[58px] min-w-0 flex-1 items-center gap-3 py-2 pr-4 shadow-[inset_0_-0.5px_0_var(--separator)] group-last/row:shadow-none'>
        <div className='min-w-0 flex-1'>
          <div className='text-body truncate'>{tx.description}</div>
          <div className='text-footnote text-label-2 flex items-center gap-1 truncate'>
            <span className='truncate'>{subtitleParts.join(' · ')}</span>
            {tx.recurrenceId && <Repeat aria-label='Repete' className='size-3 shrink-0' />}
          </div>
        </div>
        <div className='flex shrink-0 flex-col items-end gap-1'>
          <span
            className={cn(
              'font-rounded numeric text-body flex items-center gap-1 font-medium whitespace-nowrap',
              amountColor
            )}
          >
            {planned && <Clock aria-label='Previsto' className='size-3.5' strokeWidth={2.25} />}
            {amountText}
          </span>
          {planned && (
            <button
              type='button'
              disabled={update.isPending}
              onClick={(event) => {
                event.stopPropagation();
                update.mutate({ id: tx.id, status: 'DONE', scope: 'single' });
              }}
              className='bg-tint/15 text-tint text-caption h-6 rounded-full px-2.5 font-semibold transition-opacity active:opacity-50 disabled:opacity-40'
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Cartão de rodapé: Entradas, Saídas e Resultado do período. */
export function TotalsCard({ totals, title }: { totals: Totals; title?: string }) {
  return (
    <Section header={title}>
      <div className='grid grid-cols-3 divide-x divide-[var(--separator)] py-3'>
        <TotalCell label='Entradas' value={money(totals.incomeCents)} className='text-green' />
        <TotalCell label='Saídas' value={money(totals.expenseCents)} className='text-red' />
        <TotalCell
          label='Resultado'
          value={signedMoney(totals.netCents)}
          className={totals.netCents < 0 ? 'text-red' : undefined}
        />
      </div>
      {(totals.plannedIncomeCents > 0 || totals.plannedExpenseCents > 0) && (
        <div className='text-footnote text-label-2 hairline-t flex items-center justify-center gap-1.5 px-4 py-2.5'>
          <Clock className='size-3.5' />
          <span>
            Inclui previstos:{' '}
            <span className='font-rounded numeric'>+{money(totals.plannedIncomeCents)}</span> e{' '}
            <span className='font-rounded numeric'>−{money(totals.plannedExpenseCents)}</span>
          </span>
        </div>
      )}
    </Section>
  );
}

function TotalCell({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className='flex min-w-0 flex-col items-center px-2'>
      <span className='text-caption text-label-2 font-medium uppercase'>{label}</span>
      <span
        className={cn(
          'font-rounded numeric text-callout mt-0.5 max-w-full truncate font-semibold',
          className
        )}
      >
        {value}
      </span>
    </div>
  );
}
