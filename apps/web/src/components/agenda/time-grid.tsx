import { instantToWallTime } from '@jottape/finance-engine';
import type { EventOccurrence } from '@jottape/schemas';
import { type CSSProperties, useLayoutEffect, useMemo, useRef } from 'react';

import { appTimeZone, dayKey, time, timeRange, weekdayShort } from '@/lib/format';
import { cn } from '@/lib/utils';

import { coversWholeDay, DAY_MINUTES, segmentOnDay } from './calendar';
import { type ColorOf, occurrenceKey } from './calendars';
import { layoutColumns } from './layout';
import { useNow } from './use-now';

export const HOUR_HEIGHT = 56;
const PX_PER_MIN = HOUR_HEIGHT / 60;
const GUTTER = 52;
/** Respiro em cima e embaixo para os rótulos "00:00" e "24:00" não serem cortados. */
const PAD = 10;
const MIN_BLOCK_MIN = 22;

/** Fundo a ~18% da cor do evento, como os blocos do Calendário. */
export function blockStyle(color: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${color} 18%, var(--surface))`,
    borderLeft: `3px solid ${color}`,
    color: `color-mix(in srgb, ${color} 62%, var(--foreground))`,
  };
}

/** Título e horário; blocos baixos ficam numa linha só. */
function BlockContent({
  event,
  height,
  narrow,
}: {
  event: EventOccurrence;
  height: number;
  narrow: boolean;
}) {
  const short = height < 34;
  return (
    <div
      className={cn('min-w-0 overflow-hidden leading-[15px]', short && 'flex items-baseline gap-1')}
    >
      <div className={cn('text-caption truncate font-semibold', !short && 'whitespace-normal')}>
        {event.title}
      </div>
      {!narrow && (
        <div className='text-caption-2 numeric truncate opacity-80'>
          {timeRange(event.startAt, event.endAt)}
        </div>
      )}
      {!short && !narrow && height >= 64 && event.location && (
        <div className='text-caption-2 truncate opacity-70'>{event.location}</div>
      )}
    </div>
  );
}

export function AllDayChip({
  event,
  color,
  onSelect,
  compact,
}: {
  event: EventOccurrence;
  color: string;
  onSelect: (event: EventOccurrence) => void;
  compact?: boolean;
}) {
  return (
    <button
      type='button'
      onClick={() => onSelect(event)}
      className={cn(
        'block w-full min-w-0 truncate rounded-[6px] text-left font-semibold transition-opacity active:opacity-60',
        compact ? 'text-caption-2 px-1.5 py-[3px]' : 'text-footnote px-2.5 py-1.5'
      )}
      style={blockStyle(color)}
    >
      {event.title}
    </button>
  );
}

interface TimeGridProps {
  days: string[];
  byDay: Map<string, EventOccurrence[]>;
  colorOf: ColorOf;
  onSelect: (event: EventOccurrence) => void;
  /** Duplo clique num horário vazio (computador): novo evento naquela hora. */
  onCreateAt?: (day: string, hour: number) => void;
  /** Cabeçalho com dia da semana, número e faixa de dia inteiro (semana). */
  header?: boolean;
  selectedDay?: string;
  onSelectDay?: (day: string) => void;
  className?: string;
}

/**
 * Linha do tempo de 00:00 a 24:00 com uma coluna por dia. Rola sozinha (em pé e, na semana, de lado
 * no celular) com a coluna das horas e o cabeçalho presos.
 */
export function TimeGrid({
  days,
  byDay,
  colorOf,
  onSelect,
  onCreateAt,
  header,
  selectedDay,
  onSelectDay,
  className,
}: TimeGridProps) {
  const zone = appTimeZone();
  const now = useNow();
  const today = dayKey(new Date(now), zone);
  const wall = instantToWallTime(new Date(now), zone);
  const nowMinutes = wall.hour * 60 + wall.minute;
  const scroller = useRef<HTMLDivElement>(null);
  const multi = days.length > 1;
  const showsToday = days.includes(today);

  const columns = useMemo(
    () =>
      days.map((day) => {
        const all = byDay.get(day) ?? [];
        const allDay = all.filter((event) => coversWholeDay(event, day, zone));
        const timed = all.filter((event) => !coversWholeDay(event, day, zone));
        const segments = new Map(
          timed.map((event) => [occurrenceKey(event), { event, ...segmentOnDay(event, day, zone) }])
        );
        const placed = layoutColumns(
          [...segments.entries()].map(([id, s]) => ({ id, start: s.start, end: s.end })),
          MIN_BLOCK_MIN
        ).map((item) => ({ ...item, event: segments.get(item.id)!.event }));
        return { day, allDay, placed };
      }),
    [days, byDay, zone]
  );
  const hasAllDay = header && columns.some((column) => column.allDay.length);

  // Ao abrir (ou trocar de dia/semana): vai para perto de agora, ou para as 7h.
  const scrollKey = `${days[0]}:${days.length}:${selectedDay ?? ''}`;
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const target = showsToday ? Math.max(0, nowMinutes - 90) : 7 * 60;
    element.scrollTop = target * PX_PER_MIN;
    if (multi && selectedDay) {
      const column = element.querySelector<HTMLElement>(`[data-day='${selectedDay}']`);
      if (column) {
        const visible = element.clientWidth - GUTTER;
        const offset = column.offsetLeft - GUTTER;
        if (
          offset < element.scrollLeft ||
          offset + column.offsetWidth > element.scrollLeft + visible
        ) {
          element.scrollLeft = Math.max(0, offset - 8);
        }
      }
    }
    // Só ao trocar de período: o relógio andando não pode puxar a rolagem de volta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  const template = `${GUTTER}px repeat(${days.length}, minmax(${multi ? '76px' : '0'}, 1fr))`;
  const bodyHeight = DAY_MINUTES * PX_PER_MIN + PAD * 2;

  return (
    <div
      ref={scroller}
      className={cn(
        'bg-surface no-scrollbar relative overflow-auto overscroll-contain rounded-[var(--radius)]',
        className
      )}
    >
      <div className='min-w-full' style={{ width: multi ? 'max-content' : undefined }}>
        {header && (
          <div
            className='bg-surface/90 hairline-b sticky top-0 z-30 grid backdrop-blur-xl'
            style={{ gridTemplateColumns: template }}
          >
            <div className='bg-surface sticky left-0 z-10' />
            {columns.map(({ day }) => {
              const isToday = day === today;
              const selected = day === selectedDay;
              return (
                <button
                  key={day}
                  type='button'
                  onClick={() => onSelectDay?.(day)}
                  className='flex flex-col items-center gap-0.5 py-2 active:opacity-60'
                >
                  <span
                    className={cn(
                      'text-caption-2 font-semibold uppercase',
                      isToday ? 'text-tint' : 'text-label-2'
                    )}
                  >
                    {weekdayShort(day)}
                  </span>
                  <span
                    className={cn(
                      'font-rounded numeric flex size-8 items-center justify-center rounded-full text-[19px] leading-none',
                      isToday && 'bg-tint font-semibold text-white',
                      !isToday && selected && 'bg-fill font-semibold'
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>
                </button>
              );
            })}
            {hasAllDay && (
              <>
                <div className='bg-surface text-caption-2 text-label-2 hairline-t sticky left-0 z-10 flex items-start justify-end pt-1.5 pr-2'>
                  dia inteiro
                </div>
                {columns.map(({ day, allDay }) => (
                  <div key={day} className='hairline-t flex min-w-0 flex-col gap-0.5 px-0.5 py-1'>
                    {allDay.slice(0, 3).map((event) => (
                      <AllDayChip
                        key={occurrenceKey(event)}
                        event={event}
                        color={colorOf(event)}
                        onSelect={onSelect}
                        compact
                      />
                    ))}
                    {allDay.length > 3 && (
                      <span className='text-caption-2 text-label-2 px-1'>+{allDay.length - 3}</span>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <div
          className='relative grid'
          style={{ gridTemplateColumns: template, height: bodyHeight }}
        >
          {/* Horas */}
          <div className='bg-surface sticky left-0 z-20'>
            {Array.from({ length: 25 }, (_, hour) => {
              const top = PAD + hour * HOUR_HEIGHT;
              const hidden = showsToday && Math.abs(hour * 60 - nowMinutes) < 14;
              return (
                <span
                  key={hour}
                  className={cn(
                    'text-caption-2 text-label-2 numeric absolute right-2 -translate-y-1/2',
                    hidden && 'opacity-0'
                  )}
                  style={{ top }}
                >
                  {String(hour % 24).padStart(2, '0')}:00
                </span>
              );
            })}
            {showsToday && (
              <span
                className='text-caption-2 text-red numeric absolute right-1.5 -translate-y-1/2 font-semibold'
                style={{ top: PAD + nowMinutes * PX_PER_MIN }}
              >
                {time(new Date(now))}
              </span>
            )}
          </div>

          {columns.map(({ day, placed }, index) => (
            <div
              key={day}
              data-day={day}
              className='relative'
              style={{
                backgroundImage: `repeating-linear-gradient(to bottom, var(--separator) 0 0.5px, transparent 0.5px ${HOUR_HEIGHT}px)`,
                backgroundPosition: `0 ${PAD}px`,
                backgroundSize: `100% ${DAY_MINUTES * PX_PER_MIN + 1}px`,
                backgroundRepeat: 'no-repeat',
                boxShadow: multi && index > 0 ? 'inset 0.5px 0 0 var(--separator)' : undefined,
              }}
              onDoubleClick={(event) => {
                if (!onCreateAt || event.target !== event.currentTarget) return;
                const y = event.nativeEvent.offsetY - PAD;
                onCreateAt(day, Math.min(23, Math.max(0, Math.floor(y / HOUR_HEIGHT))));
              }}
            >
              {placed.map((item) => {
                const top = PAD + item.start * PX_PER_MIN;
                const height = Math.max(item.end - item.start, MIN_BLOCK_MIN) * PX_PER_MIN - 1.5;
                const narrow = multi && item.columns > 1;
                return (
                  <button
                    key={item.id}
                    type='button'
                    onClick={() => onSelect(item.event)}
                    aria-label={`${item.event.title}, ${timeRange(item.event.startAt, item.event.endAt)}`}
                    className='animate-in fade-in absolute overflow-hidden rounded-[6px] px-1.5 py-[3px] text-left duration-200 active:brightness-95'
                    style={{
                      ...blockStyle(colorOf(item.event)),
                      top,
                      height,
                      left: `calc(${(item.column / item.columns) * 100}% + 1px)`,
                      width: `calc(${(item.span / item.columns) * 100}% - 2px)`,
                      // Coluna da direita por cima, como no iPhone: o título dela fica legível.
                      zIndex: 1 + item.column,
                      boxShadow: item.column > 0 ? '0 0 0 1px var(--surface)' : undefined,
                    }}
                  >
                    <BlockContent
                      event={item.event}
                      height={height}
                      narrow={narrow && height < 48}
                    />
                  </button>
                );
              })}

              {day === today && (
                <div
                  aria-hidden
                  className='pointer-events-none absolute inset-x-0 z-[15] flex items-center'
                  style={{ top: PAD + nowMinutes * PX_PER_MIN, transform: 'translateY(-50%)' }}
                >
                  <span className='bg-red size-[9px] shrink-0 rounded-full' />
                  <span className='bg-red h-[1.5px] flex-1' />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
