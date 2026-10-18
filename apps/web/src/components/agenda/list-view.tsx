import type { EventOccurrence } from '@jottape/schemas';
import { CalendarX2 } from 'lucide-react';

import { Button, EmptyState } from '@/components/ios/controls';
import { capitalize, longDay, relativeDay } from '@/lib/format';
import { cn } from '@/lib/utils';

import { type ColorOf, occurrenceKey } from './calendars';
import { EventRow } from './event-row';

/** "Hoje · sábado, 18 de outubro"; outros dias só a data por extenso (com o ano se for outro). */
export function listDayTitle(day: string, today: string) {
  const relative = relativeDay(day, today);
  const long =
    longDay(day) + (day.slice(0, 4) !== today.slice(0, 4) ? ` de ${day.slice(0, 4)}` : '');
  return ['Hoje', 'Amanhã', 'Ontem'].includes(relative)
    ? `${relative} · ${long}`
    : capitalize(long);
}

/** Próximos dias agrupados, com o cabeçalho do dia preso no topo ao rolar. */
export function ListView({
  days,
  today,
  byDay,
  colorOf,
  onSelect,
  onCreate,
}: {
  days: string[];
  today: string;
  byDay: Map<string, EventOccurrence[]>;
  colorOf: ColorOf;
  onSelect: (event: EventOccurrence) => void;
  onCreate: () => void;
}) {
  const groups = days
    .map((day) => ({ day, events: byDay.get(day) ?? [] }))
    .filter((group) => group.events.length);

  if (!groups.length) {
    return (
      <EmptyState
        icon={<CalendarX2 />}
        title='Nenhum evento'
        message='Nada marcado nos próximos 60 dias.'
        action={
          <Button size='md' variant='tinted' onClick={onCreate}>
            Novo Evento
          </Button>
        }
      />
    );
  }

  return (
    <div className='flex flex-col gap-5'>
      {groups.map(({ day, events }) => (
        <section key={day}>
          <h2
            className={cn(
              'text-footnote bg-background/85 sticky top-[calc(env(safe-area-inset-top)+5.25rem)] z-20 -mx-4 px-8 py-1.5 font-semibold backdrop-blur-xl lg:-mx-8 lg:px-12',
              day === today ? 'text-tint' : 'text-label-2'
            )}
          >
            {listDayTitle(day, today)}
          </h2>
          <div className='bg-surface overflow-hidden rounded-[var(--radius)]'>
            {events.map((event) => (
              <EventRow
                key={occurrenceKey(event)}
                event={event}
                day={day}
                color={colorOf(event)}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
