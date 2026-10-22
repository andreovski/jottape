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
import { Switch } from '@/components/ios/controls';
import { DateInput, FieldRow } from '@/components/ios/fields';
import { Row, Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import { capitalize, monthName, todayKey } from '@/lib/format';
import { cn } from '@/lib/utils';

const KINDS: { value: StatementFilters['kind']; label: string }[] = [
  { value: 'all', label: 'Entradas e saídas' },
  { value: 'income', label: 'Só entradas' },
  { value: 'expense', label: 'Só saídas' },
];

const PRESETS: { label: string; period: (today: string) => Period }[] = [
  { label: '7 dias', period: (today) => ({ from: addDays(today, -6), to: today }) },
  { label: '30 dias', period: (today) => ({ from: addDays(today, -29), to: today }) },
  { label: '90 dias', period: (today) => ({ from: addDays(today, -89), to: today }) },
  { label: 'Este ano', period: (today) => ({ from: `${today.slice(0, 4)}-01-01`, to: today }) },
];

/**
 * Folha dos filtros do extrato: tipo, só previstos e período (o mês da tela ou um intervalo
 * qualquer). Mexe num rascunho; só vale ao tocar "Aplicar". Quem abre troca a `key` para o
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
  /** Mês da tela: vira o período inicial quando se liga o personalizado. */
  month: string;
  onApply: (filters: StatementFilters, period: Period | null) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const [custom, setCustom] = useState<Period | null>(period);

  const monthPeriod = { from: `${month}-01`, to: lastDayOfMonth(month) };
  const today = todayKey();

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title='Filtros'
      confirmLabel='Aplicar'
      onConfirm={() => onApply(draft, custom && orderedPeriod(custom))}
    >
      <Section header='Tipo'>
        {KINDS.map((option) => (
          <Row
            key={option.value}
            title={option.label}
            onClick={() => setDraft({ ...draft, kind: option.value })}
            trailing={draft.kind === option.value ? <Checkmark /> : null}
          />
        ))}
      </Section>

      <Section footer='Lançamentos com data marcada que ainda não foram pagos ou recebidos.'>
        <Row
          title='Só previstos'
          trailing={
            <Switch
              label='Só previstos'
              checked={draft.planned}
              onChange={(planned) => setDraft({ ...draft, planned })}
            />
          }
        />
      </Section>

      <Section header='Período'>
        <Row
          title={capitalize(monthName(month))}
          subtitle='O mês escolhido na tela'
          onClick={() => setCustom(null)}
          trailing={!custom ? <Checkmark /> : null}
        />
        <Row
          title='Personalizado'
          onClick={() => setCustom(custom ?? monthPeriod)}
          trailing={custom ? <Checkmark /> : null}
        />
        {custom && (
          <>
            <FieldRow label='De'>
              <DateInput
                value={custom.from}
                max={custom.to}
                onChange={(event) =>
                  event.target.value && setCustom({ ...custom, from: event.target.value })
                }
              />
            </FieldRow>
            <FieldRow label='Até'>
              <DateInput
                value={custom.to}
                min={custom.from}
                onChange={(event) =>
                  event.target.value && setCustom({ ...custom, to: event.target.value })
                }
              />
            </FieldRow>
          </>
        )}
      </Section>

      {custom && (
        <div className='-mt-4 mb-7 flex flex-wrap gap-2 px-1'>
          {PRESETS.map((preset) => {
            const value = preset.period(today);
            const active = value.from === custom.from && value.to === custom.to;
            return (
              <button
                key={preset.label}
                type='button'
                onClick={() => setCustom(value)}
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
      )}

      <Section>
        <Row title='Limpar filtros' action onClick={() => onApply(NO_FILTERS, null)} />
      </Section>
    </Sheet>
  );
}

function Checkmark() {
  return <Check className='text-tint size-5 shrink-0' strokeWidth={2.75} />;
}
