import type { AccountResponse } from '@jottape/schemas';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';

import { Sheet } from '@/components/ios/sheet';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

import { AccountCard } from './account-card';
import { accountColor, cardGradient } from './finance-utils';

/** Quanto de cada cartão aparece na pilha (nome, tipo e valor). */
const PEEK = 64;

const signed = (cents: number) => (cents < 0 ? `−${money(-cents)}` : money(cents));

/**
 * Carteira completa, como o app Wallet: os cartões empilhados, cada um mostrando só o topo, e o
 * último inteiro. Tocar num cartão abre a conta.
 */
export function AccountsSheet({
  open,
  onOpenChange,
  ...props
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & AccountsWalletProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title='Contas' cancelLabel='Fechar'>
      <AccountsWallet {...props} onOpen={() => onOpenChange(false)} />
    </Sheet>
  );
}

interface AccountsWalletProps {
  accounts: AccountResponse[];
  balanceCents: number;
  endOfMonthCents?: number;
  onAddAccount: () => void;
  /** Antes de abrir uma conta (a folha fecha). */
  onOpen?: () => void;
}

/** A carteira em si: na folha do celular e, na tela larga, fixa ao lado das Finanças. */
export function AccountsWallet({
  accounts,
  balanceCents,
  endOfMonthCents,
  onAddAccount,
  onOpen,
}: AccountsWalletProps) {
  const navigate = useNavigate();
  const invoices = accounts
    .filter((a) => a.type === 'CREDIT_CARD')
    .reduce((sum, a) => sum + (a.openInvoiceCents ?? 0), 0);
  const totals = [
    { label: 'Disponível', cents: balanceCents },
    ...(invoices ? [{ label: 'Faturas abertas', cents: invoices }] : []),
    ...(endOfMonthCents !== undefined ? [{ label: 'Fim do mês', cents: endOfMonthCents }] : []),
  ];

  return (
    <>
      <div className='mb-4 flex justify-between gap-3 px-1'>
        {totals.map((total, i) => (
          <div key={total.label} className={cn('min-w-0', i === totals.length - 1 && 'text-right')}>
            <div className='text-footnote text-label-2'>{total.label}</div>
            <div
              className={cn(
                'font-rounded numeric text-callout truncate font-semibold',
                total.cents < 0 && total.label !== 'Faturas abertas' && 'text-red'
              )}
            >
              {signed(total.cents)}
            </div>
          </div>
        ))}
      </div>

      <div>
        {accounts.map((account, i) => {
          const last = i === accounts.length - 1;
          return (
            <AccountCard
              key={account.id}
              account={account}
              peek={!last}
              className='block'
              // Sobe o cartão por cima do anterior até sobrar só a faixa do topo dele (margem em %
              // é relativa à largura, e a altura do cartão é a largura / 1,586).
              style={i ? { marginTop: `calc(${PEEK}px - 100% / 1.586)` } : undefined}
              onClick={() => {
                onOpen?.();
                void navigate({
                  to: '/financas/contas/$accountId',
                  params: { accountId: account.id },
                });
              }}
            />
          );
        })}
      </div>

      <button
        type='button'
        onClick={onAddAccount}
        className='bg-surface text-tint text-headline mt-5 flex h-[50px] w-full items-center justify-center gap-1.5 rounded-[14px] active:opacity-60 lg:hover:opacity-80'
      >
        <Plus className='size-5' strokeWidth={2.5} />
        Adicionar conta
      </button>
    </>
  );
}

/** Três mini cartões empilhados com as cores das primeiras contas (o ícone do botão de contas). */
export function AccountsStackIcon({
  accounts,
  size = 'md',
}: {
  accounts: AccountResponse[];
  size?: 'sm' | 'md';
}) {
  const shown = accounts.slice(0, 3).reverse();
  const card =
    size === 'md' ? 'h-[22px] w-[34px] rounded-[5px]' : 'h-[14px] w-[22px] rounded-[3px]';
  const step = size === 'md' ? 4 : 3;
  return (
    <span
      aria-hidden
      className={cn('relative shrink-0', size === 'md' ? 'h-[30px] w-[40px]' : 'h-5 w-[27px]')}
    >
      {shown.map((account, i) => (
        <span
          key={account.id}
          className={cn(
            'absolute shadow-[inset_0_0.5px_0_rgb(255_255_255/0.4),0_1px_2px_rgb(0_0_0/0.25)]',
            card
          )}
          style={{
            top: i * step,
            left: i * (step / 2),
            background: cardGradient(accountColor(account)),
          }}
        />
      ))}
    </span>
  );
}
