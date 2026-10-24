import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState } from 'react';

import { weekdayNarrow } from '@/lib/format';
import { cn } from '@/lib/utils';

import { shiftWeek, weekDays } from './calendar';

/** Faixa da semana do Calendário: letras, números, dia escolhido no círculo vermelho. */
export function WeekStrip({
  date,
  today,
  weekStartsOn,
  onChange,
  marks,
}: {
  date: string;
  today: string;
  weekStartsOn: number;
  onChange: (date: string) => void;
  /** Dias com algum evento (um pontinho embaixo). */
  marks?: Set<string>;
}) {
  const days = weekDays(date, weekStartsOn);
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const go = (weeks: number) => {
    setDirection(weeks > 0 ? 'right' : 'left');
    onChange(shiftWeek(date, weeks));
  };

  return (
    <div
      className='flex touch-pan-y items-center select-none'
      onTouchStart={(event) => {
        const point = event.touches[0];
        touch.current = { x: point.clientX, y: point.clientY };
      }}
      onTouchEnd={(event) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const point = event.changedTouches[0];
        const dx = point.clientX - start.x;
        const dy = point.clientY - start.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      }}
    >
      <StripArrow label='Semana anterior' onClick={() => go(-1)}>
        <ChevronLeft />
      </StripArrow>
      <div
        key={days[0]}
        className={cn(
          'grid flex-1 grid-cols-7 duration-300',
          direction && 'animate-in fade-in',
          direction === 'right' && 'slide-in-from-right-6',
          direction === 'left' && 'slide-in-from-left-6'
        )}
      >
        {days.map((day) => {
          const selected = day === date;
          const isToday = day === today;
          return (
            <button
              key={day}
              type='button'
              onClick={() => {
                setDirection(null);
                onChange(day);
              }}
              aria-pressed={selected}
              aria-label={day}
              className='flex flex-col items-center gap-1 py-1'
            >
              <span
                className={cn(
                  'text-caption-2 font-semibold uppercase',
                  isToday && !selected ? 'text-tint' : 'text-label-2'
                )}
              >
                {weekdayNarrow(day)}
              </span>
              <span
                className={cn(
                  'font-rounded numeric flex size-9 items-center justify-center rounded-full text-[20px] leading-none transition-colors duration-150',
                  selected && 'bg-tint font-semibold text-white',
                  !selected && isToday && 'text-tint font-semibold',
                  !selected && 'active:bg-fill'
                )}
              >
                {Number(day.slice(8))}
              </span>
              <span
                className={cn(
                  'bg-label-3 size-[5px] rounded-full transition-opacity',
                  marks?.has(day) ? 'opacity-100' : 'opacity-0'
                )}
              />
            </button>
          );
        })}
      </div>
      <StripArrow label='Próxima semana' onClick={() => go(1)}>
        <ChevronRight />
      </StripArrow>
    </div>
  );
}

export function StripArrow({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onClick={onClick}
      className='text-tint flex size-8 shrink-0 items-center justify-center rounded-full transition-opacity active:opacity-40 [&_svg]:size-5 [&_svg]:stroke-[2.5]'
    >
      {children}
    </button>
  );
}
