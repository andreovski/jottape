import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Grupo de linhas com cantos arredondados (UITableView .insetGrouped). */
export function Section({
  header,
  footer,
  children,
  className,
  action,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Texto à direita do cabeçalho ("Ver tudo"). */
  action?: ReactNode;
}) {
  return (
    <section className={cn('mb-7', className)}>
      {(header || action) && (
        <div className='flex items-end justify-between px-4 pb-1.5'>
          {header && <h2 className='text-footnote text-label-2 uppercase'>{header}</h2>}
          {action && <div className='text-subhead text-tint'>{action}</div>}
        </div>
      )}
      <div className='bg-surface overflow-hidden rounded-[var(--radius)]'>{children}</div>
      {footer && <p className='text-footnote text-label-2 px-4 pt-1.5'>{footer}</p>}
    </section>
  );
}

/** Cabeçalho grande de grupo, no estilo do app Lembretes / Saúde ("Minhas listas"). */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className='mt-2 mb-2 flex items-baseline justify-between px-1'>
      <h2 className='text-title-3'>{children}</h2>
      {action && <div className='text-subhead text-tint'>{action}</div>}
    </div>
  );
}

interface RowProps {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Valor em cinza à direita (como o "Wi-Fi  Casa" dos Ajustes). */
  detail?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  destructive?: boolean;
  className?: string;
  /** Linha de ação (texto na cor da seção, sem ícone). */
  action?: boolean;
  disabled?: boolean;
  /** Deixa o subtítulo quebrar em várias linhas (textos de instrução). */
  wrapSubtitle?: boolean;
}

/** Linha de lista. O separador começa depois do ícone, como no iOS. */
export function Row({
  leading,
  title,
  subtitle,
  detail,
  trailing,
  chevron,
  onClick,
  destructive,
  action,
  className,
  disabled,
  wrapSubtitle,
}: RowProps) {
  const content = (
    <>
      {leading && <div className='flex shrink-0 items-center py-2'>{leading}</div>}
      <div className='flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2.5 pr-4 shadow-[inset_0_-0.5px_0_var(--separator)] group-last/row:shadow-none'>
        <div className='min-w-0 flex-1'>
          <div
            className={cn(
              'text-body truncate',
              destructive && 'text-red',
              action && 'text-tint',
              disabled && 'opacity-40'
            )}
          >
            {title}
          </div>
          {subtitle && (
            <div className={cn('text-subhead text-label-2', !wrapSubtitle && 'truncate')}>
              {subtitle}
            </div>
          )}
        </div>
        {detail !== undefined && (
          <div className='text-body text-label-2 numeric max-w-[55%] shrink-0 truncate text-right'>
            {detail}
          </div>
        )}
        {trailing}
        {chevron && (
          <ChevronRight className='text-label-3 size-[18px] shrink-0' strokeWidth={2.5} />
        )}
      </div>
    </>
  );

  // No computador, a linha tocável clareia sob o mouse (também quando um link a envolve).
  const classes = cn(
    'group/row flex w-full items-center gap-3 pl-4 text-left lg:transition-colors lg:[a:hover>&]:bg-fill/50',
    className
  );

  if (onClick) {
    return (
      <button
        type='button'
        onClick={onClick}
        disabled={disabled}
        className={cn(
          classes,
          'active:bg-fill lg:hover:bg-fill/50 transition-colors duration-75 disabled:cursor-default lg:disabled:hover:bg-transparent'
        )}
      >
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}

/** Quadradinho colorido com ícone branco, como nos Ajustes do iPhone. */
export function IconChip({
  color,
  children,
  size = 'md',
  round,
}: {
  color: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  round?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-white',
        round ? 'rounded-full' : size === 'lg' ? 'rounded-[10px]' : 'rounded-[7px]',
        size === 'sm' && 'size-6 [&_svg]:size-3.5',
        size === 'md' && 'size-[29px] [&_svg]:size-[17px]',
        size === 'lg' && 'size-9 [&_svg]:size-5'
      )}
      style={{ backgroundColor: color }}
    >
      {children}
    </span>
  );
}
