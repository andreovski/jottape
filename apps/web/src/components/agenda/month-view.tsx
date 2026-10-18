import type { EventOccurrence } from '@jottape/schemas';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';

import { Section } from '@/components/ios/list';
import { capitalize, longDay, monthTitle, weekdayNarrow, weekdayShort } from '@/lib/format';
import { cn } from '@/lib/utils';

import { type ColorOf, occurrenceKey } from './calendars';
import { EventRow } from './event-row';
import { StripArrow } from './week-strip';

/** Mês do Calendário: semanas em linhas, pontinhos coloridos e a lista do dia tocado embaixo. */
export function MonthView({
  date,
  today,
  weeks,
  byDay,
  colorOf,
  onSelectDay,
  onShiftMonth,
  onSelect,
  onCreate,
  loading,
}: {
  date: string;
  today: string;
  weeks: string[][];
  byDay: Map<string, EventOccurrence[]>;
  colorOf: ColorOf;
  onSelectDay: (day: string) => void;
  onShiftMonth: (months: number) => void;
  onSelect: (event: EventOccurrence) => void;
  onCreate: () => void;
  loading?: boolean;
}) {
  const month = date.slice(0, 7);
  const dayEvents = byDay.get(date) ?? [];

  return (
    <div>
      <div className='bg-surface mb-6 overflow-hidden rounded-[var(--radius)]'>
        <div className='flex items-center justify-between py-2 pr-2 pl-4'>
          <span className='text-headline'>{capitalize(monthTitle(month))}</span>
          <div className='flex'>
            <StripArrow label='Mês anterior' onClick={() => onShiftMonth(-1)}>
              <ChevronLeft />
            </StripArrow>
            <StripArrow label='Próximo mês' onClick={() => onShiftMonth(1)}>
              <ChevronRight />
            </StripArrow>
          </div>
        </div>

        <div className='grid grid-cols-7 px-1 pb-1'>
          {weeks[0].map((day) => (
            <span
              key={day}
              className='text-caption-2 text-label-2 text-center font-semibold uppercase'
            >
              <span className='lg:hidden'>{weekdayNarrow(day)}</span>
              <span className='hidden lg:inline'>{weekdayShort(day)}</span>
            </span>
          ))}
        </div>

        <div
          key={month}
          className={cn(
            'animate-in fade-in duration-300',
            loading && 'opacity-60 transition-opacity'
          )}
        >
          {weeks.map((week) => (
            <div key={week[0]} className='hairline-t grid grid-cols-7 px-1'>
              {week.map((day) => {
                const events = byDay.get(day) ?? [];
                const inMonth = day.slice(0, 7) === month;
                const selected = day === date;
                const isToday = day === today;
                return (
                  <button
                    key={day}
                    type='button'
                    onClick={() => onSelectDay(day)}
                    aria-pressed={selected}
                    aria-label={`${longDay(day)}${events.length ? `, ${events.length} eventos` : ''}`}
                    className='flex min-h-[52px] min-w-0 flex-col items-center pt-1 pb-1.5 lg:min-h-[92px] lg:items-stretch lg:px-1'
                  >
                    <span
                      className={cn(
                        'font-rounded numeric flex size-[30px] items-center justify-center self-center rounded-full text-[17px] leading-none transition-colors lg:self-start',
                        !inMonth && 'text-label-3',
                        isToday && !selected && 'text-tint font-semibold',
                        selected && isToday && 'bg-tint font-semibold text-white',
                        selected && !isToday && 'bg-foreground text-background font-semibold'
                      )}
                    >
                      {Number(day.slice(8))}
                    </span>

                    {/* Celular: até 3 pontinhos. */}
                    <span className='mt-1 flex h-[6px] gap-[3px] lg:hidden'>
                      {events.slice(0, 3).map((event) => (
                        <span
                          key={occurrenceKey(event)}
                          className={cn('size-[6px] rounded-full', !inMonth && 'opacity-40')}
                          style={{ backgroundColor: colorOf(event) }}
                        />
                      ))}
                    </span>

                    {/* Computador: os títulos, como no Calendário do Mac. */}
                    <span className='mt-1 hidden min-w-0 flex-col gap-[2px] lg:flex'>
                      {events.slice(0, 3).map((event) => (
                        <span
                          key={occurrenceKey(event)}
                          className={cn(
                            'text-caption-2 flex min-w-0 items-center gap-1 text-left',
                            !inMonth && 'opacity-50'
                          )}
                        >
                          <span
                            className='size-[6px] shrink-0 rounded-full'
                            style={{ backgroundColor: colorOf(event) }}
                          />
                          <span className='truncate'>{event.title}</span>
                        </span>
                      ))}
                      {events.length > 3 && (
                        <span className='text-caption-2 text-label-2 pl-2.5 text-left'>
                          +{events.length - 3}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <Section header={capitalize(longDay(date))}>
        {dayEvents.length ? (
          dayEvents.map((event) => (
            <EventRow
              key={occurrenceKey(event)}
              event={event}
              day={date}
              color={colorOf(event)}
              onSelect={onSelect}
            />
          ))
        ) : (
          <button
            type='button'
            onClick={onCreate}
            className='text-body text-label-2 active:bg-fill flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left'
          >
            <CalendarPlus className='text-label-3 size-5' />
            {loading ? 'Carregando…' : 'Nenhum evento'}
          </button>
        )}
      </Section>
    </div>
  );
}
