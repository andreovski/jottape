import type { EventOccurrence } from '@jottape/schemas';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { setAppTimeZone } from '@/lib/format';

import { eventsByDay, monthGrid, weekDays } from './calendar';
import { ListView } from './list-view';
import { MonthView } from './month-view';
import { TimeGrid } from './time-grid';

const TZ = 'America/Sao_Paulo';
setAppTimeZone(TZ);

const base: EventOccurrence = {
  eventId: 'a',
  occurrenceStart: '2026-10-20T12:00:00.000Z',
  startAt: '2026-10-20T12:00:00.000Z',
  endAt: '2026-10-20T13:00:00.000Z',
  allDay: false,
  title: 'Dentista',
  description: null,
  location: 'Centro',
  color: null,
  rrule: null,
  isRecurring: false,
  isException: false,
  source: 'LOCAL',
  calendarId: null,
  reminders: [],
};
const events: EventOccurrence[] = [
  base,
  {
    ...base,
    eventId: 'b',
    title: 'Reunião',
    startAt: '2026-10-20T12:30:00.000Z',
    endAt: '2026-10-20T14:00:00.000Z',
  },
  {
    ...base,
    eventId: 'c',
    title: 'Feriado',
    allDay: true,
    startAt: '2026-10-20T00:00:00.000Z',
    endAt: '2026-10-21T00:00:00.000Z',
  },
];
const colorOf = () => 'var(--red)';

describe('visões', () => {
  it('semana mostra blocos e a faixa de dia inteiro', () => {
    const days = weekDays('2026-10-20', 0);
    const onSelect = vi.fn();
    render(
      <TimeGrid
        header
        days={days}
        byDay={eventsByDay(events, days, TZ)}
        colorOf={colorOf}
        onSelect={onSelect}
        selectedDay='2026-10-20'
      />
    );
    screen.getByRole('button', { name: /Dentista/ }).click();
    expect(onSelect).toHaveBeenCalledWith(base);
    expect(screen.getByText('Reunião')).toBeInTheDocument();
    expect(screen.getByText('Feriado')).toBeInTheDocument();
  });

  it('mês lista os eventos do dia escolhido', () => {
    const weeks = monthGrid('2026-10-20', 1);
    render(
      <MonthView
        date='2026-10-20'
        today='2026-10-18'
        weeks={weeks}
        byDay={eventsByDay(events, weeks.flat(), TZ)}
        colorOf={colorOf}
        onSelectDay={vi.fn()}
        onShiftMonth={vi.fn()}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />
    );
    expect(screen.getByText('Terça-feira, 20 de outubro')).toBeInTheDocument();
    expect(screen.getByText('dia inteiro')).toBeInTheDocument();
    expect(screen.getAllByText('Dentista').length).toBeGreaterThan(0);
  });

  it('lista vazia mostra o estado vazio', () => {
    render(
      <ListView
        days={['2026-10-18']}
        today='2026-10-18'
        byDay={new Map()}
        colorOf={colorOf}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />
    );
    expect(screen.getByText('Nenhum evento')).toBeInTheDocument();
  });
});
