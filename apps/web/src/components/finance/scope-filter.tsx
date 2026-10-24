import { Check, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

import { Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import { cn } from '@/lib/utils';

import type { StatementScope } from './finance-utils';

export const SCOPE_OPTIONS: { value: StatementScope; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'accounts', label: 'Contas' },
  { value: 'cards', label: 'Cartão' },
];

const isScope = (value: unknown): value is StatementScope =>
  SCOPE_OPTIONS.some((option) => option.value === value);

/** Recorte vindo da URL; qualquer outra coisa é "Tudo". */
export const resolveScope = (value: unknown): StatementScope => (isScope(value) ? value : 'all');

export const scopeLabel = (scope: StatementScope) =>
  SCOPE_OPTIONS.find((option) => option.value === scope)?.label ?? 'Tudo';

/**
 * Botão de filtro com o recorte escolhido ("Tudo", "Contas", "Cartão"); fora de "Tudo" fica
 * preenchido, como o botão de filtros do extrato. Abre a folha que troca o recorte.
 */
export function ScopeFilter({
  scope,
  onChange,
  onSurface,
}: {
  scope: StatementScope;
  onChange: (scope: StatementScope) => void;
  /** Dentro de um cartão branco: o fundo apagado vira cinza para aparecer. */
  onSurface?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const on = scope !== 'all';
  return (
    <>
      <button
        type='button'
        onClick={() => {
          setSession((value) => value + 1);
          setOpen(true);
        }}
        aria-label={`Filtrar: ${scopeLabel(scope)}`}
        className={cn(
          'text-footnote flex h-7 shrink-0 items-center gap-1 rounded-full pr-2.5 pl-2 font-semibold normal-case transition-colors active:opacity-60',
          on ? 'bg-tint text-white' : cn(onSurface ? 'bg-fill' : 'bg-surface', 'text-tint')
        )}
      >
        <SlidersHorizontal className='size-[15px]' strokeWidth={2.25} />
        {scopeLabel(scope)}
      </button>
      <ScopeSheet
        key={session}
        open={open}
        onOpenChange={setOpen}
        scope={scope}
        onApply={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </>
  );
}

/** Folha do recorte: chips de escolha única; só vale ao tocar "Aplicar". */
function ScopeSheet({
  open,
  onOpenChange,
  scope,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: StatementScope;
  onApply: (scope: StatementScope) => void;
}) {
  const [draft, setDraft] = useState(scope);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title='Filtros'
      confirmLabel='Aplicar'
      onConfirm={() => onApply(draft)}
    >
      <Section
        header='Lançamentos de'
        footer='Contas são as contas e carteiras; Cartão, as compras nos cartões de crédito.'
      >
        <div className='flex flex-wrap gap-2 px-4 py-3'>
          {SCOPE_OPTIONS.map((option) => {
            const selected = draft === option.value;
            return (
              <button
                key={option.value}
                type='button'
                aria-pressed={selected}
                onClick={() => setDraft(option.value)}
                className={cn(
                  'text-subhead flex h-8 items-center gap-1 rounded-full px-3.5 font-medium transition-colors active:opacity-60',
                  selected ? 'bg-tint text-white' : 'bg-fill text-foreground'
                )}
              >
                {selected && <Check className='-ml-0.5 size-4' strokeWidth={2.75} />}
                {option.label}
              </button>
            );
          })}
        </div>
      </Section>
    </Sheet>
  );
}
