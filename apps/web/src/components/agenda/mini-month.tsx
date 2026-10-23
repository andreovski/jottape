import { addMonthsClamped } from '@jottape/finance-engine';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { capitalize, longDay, monthTitle, weekdayNarrow } from '@/lib/format';
import { cn } from '@/lib/utils';

import { monthGrid } from './calendar';
import { StripArrow } from './week-strip';

/**
 * Mês pequeno para pular de dia, ao lado da visão Dia na tela larga (como a coluna do Calendário
 * no Mac). Só aparece no computador.
 */
export function MiniMonth({
  date,
  today,
  weekStartsOn,
  onChange,
}: {
  date: string;
  today: string;
  weekStartsOn: number;
  onChange: (date: string) => void;
}) {
  const month = date.slice(0, 7);
  const weeks = monthGrid(date, weekStartsOn);

  return (
    <div className='bg-surface rounded-[var(--radius)] px-2 pt-1 pb-2'>
      <div className='flex items-center justify-between py-1 pl-2'>
        <span className='text-headline'>{capitalize(monthTitle(month))}</span>
        <div className='flex'>
          <StripArrow label='Mês anterior' onClick={() => onChange(addMonthsClamped(date, -1))}>
            <ChevronLeft />
          </StripArrow>
          <StripArrow label='Próximo mês' onClick={() => onChange(addMonthsClamped(date, 1))}>
            <ChevronRight />
          </StripArrow>
        </div>
      </div>
      <div className='grid grid-cols-7'>
        {weeks[0].map((day) => (
          <span
            key={day}
            className='text-caption-2 text-label-2 py-1 text-center font-semibold uppercase'
          >
            {weekdayNarrow(day)}
          </span>
        ))}
        {weeks.flat().map((day) => {
          const selected = day === date;
          const isToday = day === today;
          return (
            <button
              key={day}
              type='button'
              onClick={() => onChange(day)}
              aria-pressed={selected}
              aria-label={longDay(day)}
              className='flex h-9 items-center justify-center'
            >
              <span
                className={cn(
                  'font-rounded numeric flex size-8 items-center justify-center rounded-full text-[15px] leading-none transition-colors',
                  day.slice(0, 7) !== month && 'text-label-3',
                  !selected && 'hover:bg-fill',
                  !selected && isToday && 'text-tint font-semibold',
                  selected && 'bg-tint font-semibold text-white'
                )}
              >
                {Number(day.slice(8))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
