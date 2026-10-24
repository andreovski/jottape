import { parseCents } from '@jottape/finance-engine';
import { CircleAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

const inputClass =
  'text-body placeholder:text-label-3 w-full min-w-0 bg-transparent outline-none disabled:opacity-50 group-data-[invalid]/row:placeholder:text-red/70';

/** Mensagem de erro de um campo (vermelha, com o ícone de alerta). */
export function FieldError({ message, className }: { message?: string; className?: string }) {
  if (!message) return null;
  return (
    <p
      role='alert'
      className={cn('text-footnote text-red flex items-center gap-1 text-left', className)}
    >
      <CircleAlert className='size-3.5 shrink-0' strokeWidth={2.4} aria-hidden />
      {message}
    </p>
  );
}

/**
 * Linha com rótulo à esquerda e campo à direita (ou só o campo, sem rótulo). Com `error`, o rótulo
 * fica vermelho e a mensagem aparece embaixo, dentro da própria linha.
 */
export function FieldRow({
  label,
  children,
  leading,
  error,
}: {
  label?: string;
  children: ReactNode;
  leading?: ReactNode;
  error?: string;
}) {
  return (
    <label
      data-field-error={error ? '' : undefined}
      data-invalid={error ? '' : undefined}
      className='group/row flex min-h-11 w-full items-center gap-3 pl-4'
    >
      {leading}
      <div className='flex min-h-11 min-w-0 flex-1 flex-col justify-center py-1.5 pr-4 shadow-[inset_0_-0.5px_0_var(--separator)] group-last/row:shadow-none'>
        <div className='flex min-h-8 items-center gap-3'>
          {label && (
            <span className={cn('text-body shrink-0 transition-colors', error && 'text-red')}>
              {label}
            </span>
          )}
          <div
            className={cn('flex min-w-0 flex-1 items-center', label && 'justify-end text-right')}
          >
            {children}
          </div>
        </div>
        <FieldError message={error} className='pb-0.5' />
      </div>
    </label>
  );
}

export function TextInput({
  className,
  align,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { align?: 'right' }) {
  return (
    <input
      className={cn(inputClass, align === 'right' && 'text-label-2 text-right', className)}
      {...props}
    />
  );
}

export function TextArea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      className={cn(inputClass, 'resize-none py-1.5 leading-[22px]', className)}
      {...props}
    />
  );
}

/** Seletor nativo com o visual de "valor cinza + setas" do iOS. */
export function SelectInput({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Com `group`, as opções saem agrupadas (na ordem em que o grupo aparece). */
  options: { value: string; label: string; group?: string }[];
  placeholder?: string;
  className?: string;
}) {
  const groups = [...new Set(options.map((option) => option.group))];
  const render = (list: typeof options) =>
    list.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ));
  return (
    <span className={cn('relative inline-flex max-w-full items-center', className)}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className='text-body text-label-2 max-w-full appearance-none truncate bg-transparent pr-5 text-right outline-none'
      >
        {placeholder !== undefined && <option value=''>{placeholder}</option>}
        {groups.length > 1 || groups[0] !== undefined
          ? groups.map((group) => (
              <optgroup key={group ?? ''} label={group ?? ''}>
                {render(options.filter((option) => option.group === group))}
              </optgroup>
            ))
          : render(options)}
      </select>
      <svg
        aria-hidden
        viewBox='0 0 10 16'
        className='text-label-3 pointer-events-none absolute right-0 h-3.5 w-2.5'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <path d='M2 6l3-3 3 3M2 10l3 3 3-3' />
      </svg>
    </span>
  );
}

/** Data/hora nativas: no iPhone abrem as rodas do sistema. */
export function DateInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type='date'
      className='bg-fill text-body numeric rounded-[8px] px-2.5 py-1 text-right outline-none [&::-webkit-calendar-picker-indicator]:hidden'
      {...props}
    />
  );
}

export function TimeInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type='time'
      className='bg-fill text-body numeric rounded-[8px] px-2.5 py-1 text-right outline-none [&::-webkit-calendar-picker-indicator]:hidden'
      {...props}
    />
  );
}

/**
 * Valor grande no centro, como o Apple Cash: digita-se os centavos e a vírgula anda sozinha
 * ("1" → 0,01; "1234" → 12,34).
 */
export function AmountInput({
  value,
  onChange,
  color,
  autoFocus,
  error,
}: {
  value: number;
  onChange: (cents: number) => void;
  color?: string;
  autoFocus?: boolean;
  error?: string;
}) {
  const text = value ? String(value) : '';

  return (
    <div
      data-field-error={error ? '' : undefined}
      className='relative flex flex-col items-center py-4'
    >
      <div
        className='font-rounded numeric text-[48px] leading-none font-semibold tracking-tight transition-colors'
        style={{
          color: value
            ? color
            : error
              ? 'color-mix(in srgb, var(--red) 70%, transparent)'
              : 'var(--label-3)',
        }}
      >
        {money(value)}
      </div>
      <FieldError message={error} className='mt-2' />
      <input
        aria-label='Valor'
        inputMode='numeric'
        autoFocus={autoFocus}
        value={text}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '').slice(0, 11);
          onChange(Number(digits || '0'));
        }}
        onPaste={(event) => {
          const parsed = parseCents(event.clipboardData.getData('text'));
          if (parsed !== null) {
            event.preventDefault();
            onChange(Math.abs(parsed));
          }
        }}
        className='absolute inset-0 cursor-text opacity-0'
      />
    </div>
  );
}

/** Entrada de valor pequena (numa linha): aceita "1.234,56". */
export function MoneyField({
  value,
  onChange,
  placeholder = 'R$ 0,00',
  allowNegative,
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  placeholder?: string;
  allowNegative?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : money(value));
  return (
    <input
      inputMode='decimal'
      value={text}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      // Tocar seleciona o valor, para digitar por cima sem apagar antes.
      onFocus={(event) => event.target.select()}
      onBlur={() => {
        const parsed = parseCents(text);
        const cents = parsed === null ? null : allowNegative ? parsed : Math.abs(parsed);
        onChange(cents);
        setText(cents === null ? '' : money(cents));
      }}
      className={cn(inputClass, 'numeric text-label-2 text-right')}
    />
  );
}

/** Paleta das listas, contas e categorias (as cores do sistema). */
export const SWATCHES = [
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#00c7be',
  '#32ade6',
  '#007aff',
  '#5856d6',
  '#af52de',
  '#ff2d55',
  '#a2845e',
  '#8e8e93',
];

export function ColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string) => void;
}) {
  return (
    <div className='grid grid-cols-6 gap-3 p-4'>
      {SWATCHES.map((color) => (
        <button
          key={color}
          type='button'
          aria-label={`Cor ${color}`}
          aria-pressed={value === color}
          onClick={() => onChange(color)}
          className={cn(
            'mx-auto size-10 rounded-full ring-offset-2 ring-offset-[var(--surface)] transition-transform active:scale-90',
            value?.toLowerCase() === color && 'ring-label-3 ring-[3px]'
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
