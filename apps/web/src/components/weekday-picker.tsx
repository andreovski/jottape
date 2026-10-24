import { addDays } from '@jottape/finance-engine';

import { weekdayOrder } from '@/components/agenda/calendar';
import { weekdayNarrow } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Um domingo qualquer: dá a letra de cada dia da semana. */
const SUNDAY = '2026-10-18';

/**
 * Os sete dias da semana em bolinhas, para a repetição semanal (evento e tarefa). Sem
 * `allowEmpty`, sempre fica pelo menos um dia marcado.
 */
export function WeekdayPicker({
  value,
  onChange,
  weekStartsOn,
  allowEmpty = false,
}: {
  /** 0 = domingo. */
  value: number[];
  onChange: (weekdays: number[]) => void;
  weekStartsOn: number;
  allowEmpty?: boolean;
}) {
  return (
    <div className='flex justify-between gap-1 px-4 py-2.5 shadow-[inset_0_-0.5px_0_var(--separator)]'>
      {weekdayOrder(weekStartsOn).map((weekday) => {
        const active = value.includes(weekday);
        return (
          <button
            key={weekday}
            type='button'
            aria-pressed={active}
            aria-label={`Dia da semana ${weekday}`}
            onClick={() => {
              const next = active ? value.filter((d) => d !== weekday) : [...value, weekday];
              if (next.length || allowEmpty) onChange(next);
            }}
            className={cn(
              'text-footnote flex size-9 items-center justify-center rounded-full font-semibold transition-colors duration-150 active:scale-95',
              active ? 'bg-tint text-white' : 'bg-fill text-foreground'
            )}
          >
            {weekdayNarrow(addDays(SUNDAY, weekday))}
          </button>
        );
      })}
    </div>
  );
}
