import { addDays } from '@jottape/finance-engine';
import { Check } from 'lucide-react';
import { useState } from 'react';

import {
  lastDayOfMonth,
  NO_FILTERS,
  orderedPeriod,
  type Period,
  type StatementFilters,
} from '@/components/finance/finance-utils';
import { DateInput, FieldRow } from '@/components/ios/fields';
import { Row, Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import { todayKey } from '@/lib/format';
import { cn } from '@/lib/utils';

const KINDS: { key: keyof StatementFilters; label: string }[] = [
  { key: 'income', label: 'Entradas' },
  { key: 'expense', label: 'Saídas' },
  { key: 'planned', label: 'Previstos' },
];

const PRESETS: { label: string; period: (today: string, month: Period) => Period }[] = [
  { label: 'Mês da tela', period: (_, month) => month },
  { label: '7 dias', period: (today) => ({ from: addDays(today, -6), to: today }) },
  { label: '30 dias', period: (today) => ({ from: addDays(today, -29), to: today }) },
  { label: '90 dias', period: (today) => ({ from: addDays(today, -89), to: today }) },
  { label: 'Este ano', period: (today) => ({ from: `${today.slice(0, 4)}-01-01`, to: today }) },
];

/**
 * Folha dos filtros do extrato: chips de tipo (todos ligados por padrão) e período, que já vem com
 * o início e o fim do mês da tela; mudar as datas vira um período personalizado. Mexe num rascunho; só vale ao tocar "Aplicar". Quem abre troca a `key` para o
 * rascunho começar do que está aplicado.
 */
export function StatementFiltersSheet({
  open,
  onOpenChange,
  filters,
  period,
  month,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: StatementFilters;
  period: Period | null;
  /** Mês da tela: as datas iniciais do período. */
  month: string;
  onApply: (filters: StatementFilters, period: Period | null) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const monthPeriod = { from: `${month}-01`, to: lastDayOfMonth(month) };
  const [range, setRange] = useState<Period>(period ?? monthPeriod);
  const today = todayKey();

  const apply = () => {
    const chosen = orderedPeriod(range);
    const isMonth = chosen.from === monthPeriod.from && chosen.to === monthPeriod.to;
    onApply(draft, isMonth ? null : chosen);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title='Filtros'
      confirmLabel='Aplicar'
      onConfirm={apply}
    >
      <Section
        header='Tipo'
        footer='Previstos são os que têm data marcada e ainda não foram pagos ou recebidos.'
      >
        <div className='flex flex-wrap gap-2 px-4 py-3'>
          {KINDS.map((option) => {
            const on = draft[option.key];
            const last = on && KINDS.filter((k) => draft[k.key]).length === 1;
            return (
              <button
                key={option.key}
                type='button'
                aria-pressed={on}
                // Pelo menos um fica marcado: sem nenhum, a lista ficaria sempre vazia.
                onClick={() => !last && setDraft({ ...draft, [option.key]: !on })}
                className={cn(
                  'text-subhead flex h-8 items-center gap-1 rounded-full px-3.5 font-medium transition-colors active:opacity-60',
                  on ? 'bg-tint text-white' : 'bg-fill text-foreground'
                )}
              >
                {on && <Check className='-ml-0.5 size-4' strokeWidth={2.75} />}
                {option.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section header='Período'>
        <FieldRow label='De'>
          <DateInput
            value={range.from}
            onChange={(event) =>
              event.target.value && setRange({ ...range, from: event.target.value })
            }
          />
        </FieldRow>
        <FieldRow label='Até'>
          <DateInput
            value={range.to}
            onChange={(event) =>
              event.target.value && setRange({ ...range, to: event.target.value })
            }
          />
        </FieldRow>
      </Section>

      <div className='-mt-4 mb-7 flex flex-wrap gap-2 px-1'>
        {PRESETS.map((preset) => {
          const value = preset.period(today, monthPeriod);
          const active = value.from === range.from && value.to === range.to;
          return (
            <button
              key={preset.label}
              type='button'
              onClick={() => setRange(value)}
              className={cn(
                'text-footnote h-7 rounded-full px-3 font-medium transition-colors active:opacity-60',
                active ? 'bg-tint text-white' : 'bg-surface text-foreground'
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <Section>
        <Row title='Limpar filtros' action onClick={() => onApply(NO_FILTERS, null)} />
      </Section>
    </Sheet>
  );
}
