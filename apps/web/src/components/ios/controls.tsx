import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** UISegmentedControl. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role='tablist'
      className={cn('bg-fill grid rounded-[9px] p-[2px]', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type='button'
            role='tab'
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-[7px] font-medium transition-all duration-200',
              size === 'md' ? 'text-footnote h-8 px-2' : 'text-caption h-7 px-1.5',
              active
                ? 'bg-surface dark:bg-surface-3 text-foreground shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04)]'
                : 'text-foreground/80'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** UISwitch. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40',
        checked ? 'bg-green' : 'bg-fill-2'
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] left-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_3px_1px_rgb(0_0_0/0.06)] transition-transform duration-200',
          checked && 'translate-x-5'
        )}
      />
    </button>
  );
}

/** Círculo de concluir do app Lembretes. */
export function CheckCircle({
  checked,
  onChange,
  color = 'var(--tint)',
  label,
}: {
  checked: boolean;
  onChange: () => void;
  color?: string;
  label: string;
}) {
  return (
    <button
      type='button'
      role='checkbox'
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
      className='group/check flex size-7 shrink-0 items-center justify-center'
    >
      <span
        className={cn(
          'flex size-[22px] items-center justify-center rounded-full border-[1.5px] transition-all duration-200 group-active/check:scale-90',
          !checked && 'border-label-3'
        )}
        style={checked ? { borderColor: color, backgroundColor: color } : undefined}
      >
        {checked && <Check className='size-3.5 text-white' strokeWidth={3.5} />}
      </span>
    </button>
  );
}

type ButtonVariant = 'filled' | 'tinted' | 'gray' | 'plain' | 'destructive';

/** Botões do iOS 15+: preenchido, tingido, cinza e simples. */
export function Button({
  variant = 'filled',
  size = 'lg',
  className,
  children,
  loading,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}) {
  return (
    <button
      type='button'
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold transition-[opacity,transform] duration-100 select-none active:scale-[0.98] active:opacity-70 disabled:pointer-events-none disabled:opacity-40',
        size === 'lg' && 'text-body h-[50px] rounded-[14px] px-5',
        size === 'md' && 'text-subhead h-[38px] rounded-[10px] px-4',
        size === 'sm' && 'text-footnote h-[30px] rounded-full px-3',
        variant === 'filled' && 'bg-tint text-white',
        variant === 'tinted' && 'bg-tint/15 text-tint',
        variant === 'gray' && 'bg-fill text-tint',
        variant === 'plain' && 'text-tint',
        variant === 'destructive' && 'bg-red/15 text-red',
        className
      )}
      disabled={props.disabled || loading}
      {...props}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

/** Indicador de atividade em pétalas (UIActivityIndicatorView). */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn('relative inline-block size-5', className)}
      role='status'
      aria-label='Carregando'
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <span
          key={i}
          className='absolute top-0 left-1/2 h-full w-[2px] -translate-x-1/2'
          style={{ transform: `rotate(${i * 45}deg)` }}
        >
          <span
            className='block h-[30%] w-full animate-pulse rounded-full bg-current'
            style={{ animationDelay: `${i * 0.1}s`, opacity: 0.25 + i * 0.09 }}
          />
        </span>
      ))}
    </span>
  );
}

/** Estado vazio com ícone grande, como nos apps da Apple. */
export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: ReactNode;
  title: string;
  message?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className='flex flex-col items-center px-8 py-14 text-center'>
      <div className='text-label-3 mb-3 [&_svg]:size-14 [&_svg]:stroke-[1.25]'>{icon}</div>
      <div className='text-title-3'>{title}</div>
      {message && <p className='text-subhead text-label-2 mt-1 max-w-xs'>{message}</p>}
      {action && <div className='mt-5'>{action}</div>}
    </div>
  );
}

/** Pílula de etiqueta/estado. */
export function Pill({
  children,
  color = 'var(--gray)',
  className,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'text-caption inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold',
        className
      )}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-fill animate-pulse rounded-[var(--radius)]', className)} />;
}
