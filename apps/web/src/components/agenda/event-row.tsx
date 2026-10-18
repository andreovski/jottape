import type { EventOccurrence } from '@jottape/schemas';
import { Repeat } from 'lucide-react';

import { appTimeZone, time } from '@/lib/format';

import { coversWholeDay, occurrenceSpan } from './calendar';

/** As duas linhas da coluna de horário, para o dia mostrado. */
export function timeLines(event: EventOccurrence, day: string, zone = appTimeZone()) {
  if (coversWholeDay(event, day, zone)) return ['dia inteiro', ''];
  const { first, last } = occurrenceSpan(event, zone);
  if (first === last) return [time(event.startAt), time(event.endAt)];
  if (day === first) return [time(event.startAt), 'início'];
  return ['até', time(event.endAt)];
}

/** Linha da lista do Calendário: horário, barrinha colorida, título e local. */
export function EventRow({
  event,
  day,
  color,
  onSelect,
}: {
  event: EventOccurrence;
  day: string;
  color: string;
  onSelect: (event: EventOccurrence) => void;
}) {
  const [top, bottom] = timeLines(event, day);
  return (
    <button
      type='button'
      onClick={() => onSelect(event)}
      className='group/row active:bg-fill flex w-full items-stretch gap-3 pl-4 text-left transition-colors duration-75'
    >
      <div className='flex min-w-0 flex-1 items-stretch gap-3 py-2.5 pr-4 shadow-[inset_0_-0.5px_0_var(--separator)] group-last/row:shadow-none'>
        <div className='numeric flex w-[52px] shrink-0 flex-col justify-center text-right'>
          <span className='text-footnote font-medium'>{top}</span>
          {bottom && <span className='text-footnote text-label-2'>{bottom}</span>}
        </div>
        <span className='w-[3px] shrink-0 rounded-full' style={{ backgroundColor: color }} />
        <div className='flex min-w-0 flex-1 flex-col justify-center'>
          <div className='text-body flex items-center gap-1.5'>
            <span className='truncate'>{event.title}</span>
            {event.isRecurring && (
              <Repeat className='text-label-3 size-3.5 shrink-0' strokeWidth={2.25} />
            )}
          </div>
          {event.location && (
            <div className='text-subhead text-label-2 truncate'>{event.location}</div>
          )}
        </div>
      </div>
    </button>
  );
}
