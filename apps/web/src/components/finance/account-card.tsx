import { ACCOUNT_TYPE_LABELS, type AccountResponse, type AccountType } from '@jottape/schemas';
import { CreditCard, Landmark, type LucideIcon, PiggyBank, Plus, Wallet } from 'lucide-react';

import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

import { accountColor, cardGradient } from './finance-utils';

export const ACCOUNT_TYPE_ICONS: Record<AccountType, LucideIcon> = {
  CHECKING: Landmark,
  SAVINGS: PiggyBank,
  WALLET: Wallet,
  CREDIT_CARD: CreditCard,
};

const cardShape =
  'relative aspect-[1.586] w-full overflow-hidden rounded-[16px] text-left select-none';

/** Cartão do Wallet: cor da conta em gradiente, brilho no topo, texto branco. */
export function AccountCard({
  account,
  onClick,
  size = 'md',
  className,
}: {
  account: AccountResponse;
  onClick?: () => void;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const color = accountColor(account);
  const Icon = ACCOUNT_TYPE_ICONS[account.type];
  const isCard = account.type === 'CREDIT_CARD';
  const value = isCard ? (account.openInvoiceCents ?? 0) : account.balanceCents;

  const content = (
    <>
      {/* Brilho do topo e reflexo diagonal, como o plástico dos cartões do Wallet. */}
      <span
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(120% 70% at 15% -10%, rgb(255 255 255 / 0.32), transparent 60%), linear-gradient(115deg, transparent 55%, rgb(255 255 255 / 0.07) 55%, transparent 80%)',
        }}
      />
      <span
        aria-hidden
        className='pointer-events-none absolute inset-0 rounded-[16px] shadow-[inset_0_1px_0_rgb(255_255_255/0.35),inset_0_0_0_0.5px_rgb(255_255_255/0.18)]'
      />
      <span className='relative flex h-full flex-col justify-between p-4 text-white'>
        <span className='flex items-start justify-between gap-3'>
          <span className='min-w-0'>
            <span
              className={cn(
                'block truncate font-semibold',
                size === 'lg' ? 'text-title-3' : 'text-headline'
              )}
            >
              {account.name}
            </span>
            <span className='text-footnote block truncate text-white/75'>
              {ACCOUNT_TYPE_LABELS[account.type]}
              {account.archived && ' · Arquivada'}
            </span>
          </span>
          <Icon className='size-6 shrink-0 text-white/85' strokeWidth={1.75} />
        </span>
        <span className='flex items-end justify-between gap-3'>
          <span className='min-w-0'>
            <span className='text-caption block font-medium tracking-wide text-white/75 uppercase'>
              {isCard ? 'Fatura aberta' : 'Saldo'}
            </span>
            <span
              className={cn(
                'font-rounded numeric block truncate leading-tight font-semibold tracking-tight',
                size === 'lg' ? 'text-[34px]' : 'text-[26px]'
              )}
            >
              {!isCard && value < 0 ? `−${money(-value)}` : money(value)}
            </span>
          </span>
          {isCard && account.closingDay && (
            <span className='text-footnote shrink-0 pb-1 text-white/80'>
              fecha dia {account.closingDay}
            </span>
          )}
        </span>
      </span>
    </>
  );

  const style = {
    background: cardGradient(color),
    boxShadow: `0 10px 24px -12px color-mix(in srgb, ${color} 70%, transparent)`,
  };

  if (onClick) {
    return (
      <button
        type='button'
        onClick={onClick}
        className={cn(
          cardShape,
          'transition-transform duration-150 active:scale-[0.97]',
          className
        )}
        style={style}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={cn(cardShape, className)} style={style}>
      {content}
    </div>
  );
}

/** Versão pequena do cartão, para a faixa de contas fixa no topo das Finanças. */
export function AccountChip({
  account,
  onClick,
}: {
  account: AccountResponse;
  onClick: () => void;
}) {
  const color = accountColor(account);
  const Icon = ACCOUNT_TYPE_ICONS[account.type];
  const isCard = account.type === 'CREDIT_CARD';
  const value = isCard ? (account.openInvoiceCents ?? 0) : account.balanceCents;
  return (
    <button
      type='button'
      onClick={onClick}
      className='relative flex h-[58px] w-[148px] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-[12px] px-3 py-2 text-left text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)] transition-transform duration-150 select-none active:scale-[0.96]'
      style={{
        background: cardGradient(color),
        boxShadow: `0 6px 14px -10px color-mix(in srgb, ${color} 80%, transparent)`,
      }}
    >
      <span className='flex items-center gap-1.5'>
        <Icon className='size-3.5 shrink-0 text-white/85' strokeWidth={2} />
        <span className='text-caption truncate font-semibold'>{account.name}</span>
      </span>
      <span className='font-rounded numeric text-callout truncate leading-tight font-semibold'>
        {isCard && <span className='text-caption-2 mr-1 font-medium text-white/75'>Fatura</span>}
        {!isCard && value < 0 ? `−${money(-value)}` : money(value)}
      </span>
    </button>
  );
}

/** "Adicionar conta" no tamanho do `AccountChip`. */
export function AddAccountChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label='Adicionar conta'
      className='border-label-3 text-tint flex h-[58px] w-[58px] shrink-0 snap-start items-center justify-center rounded-[12px] border-2 border-dashed transition-transform active:scale-[0.96]'
    >
      <Plus className='size-6' strokeWidth={2.5} />
    </button>
  );
}
