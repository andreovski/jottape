import { ACCOUNT_TYPE_LABELS, type AccountResponse, type AccountType } from '@jottape/schemas';
import { CreditCard, Landmark, type LucideIcon, PiggyBank, Wallet } from 'lucide-react';

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
  peek,
  className,
  style: extraStyle,
}: {
  account: AccountResponse;
  onClick?: () => void;
  size?: 'md' | 'lg';
  /** Na pilha da folha de contas só o topo aparece: o valor sobe para o lado do nome. */
  peek?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const color = accountColor(account);
  const Icon = ACCOUNT_TYPE_ICONS[account.type];
  const isCard = account.type === 'CREDIT_CARD';
  const value = isCard ? (account.openInvoiceCents ?? 0) : account.balanceCents;
  const formatted = !isCard && value < 0 ? `−${money(-value)}` : money(value);

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
          {peek ? (
            <span className='font-rounded numeric text-headline shrink-0 font-semibold'>
              {isCard && (
                <span className='text-caption mr-1 font-medium text-white/75'>Fatura</span>
              )}
              {formatted}
            </span>
          ) : (
            <Icon className='size-6 shrink-0 text-white/85' strokeWidth={1.75} />
          )}
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
              {formatted}
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
    ...extraStyle,
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
