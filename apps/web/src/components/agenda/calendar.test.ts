import type { EventOccurrence } from '@jottape/schemas';
import { describe, expect, it } from 'vitest';

import {
  coversWholeDay,
  dayRange,
  eventsByDay,
  monthGrid,
  occurrenceSpan,
  segmentOnDay,
  startOfWeek,
  weekdayOrder,
  weekDays,
} from './calendar';

const TZ = 'America/Sao_Paulo';

function event(partial: Partial<EventOccurrence>): EventOccurrence {
  return {
    eventId: 'e',
    occurrenceStart: partial.startAt ?? '2026-10-18T12:00:00.000Z',
    startAt: '2026-10-18T12:00:00.000Z',
    endAt: '2026-10-18T13:00:00.000Z',
    allDay: false,
    title: 'Evento',
    description: null,
    location: null,
    color: null,
    rrule: null,
    isRecurring: false,
    isException: false,
    source: 'LOCAL',
    calendarId: null,
    reminders: [],
    ...partial,
  };
}

describe('semanas', () => {
  it('começa no domingo ou na segunda conforme o perfil', () => {
    // 2026-10-18 é domingo.
    expect(startOfWeek('2026-10-18', 0)).toBe('2026-10-18');
    expect(startOfWeek('2026-10-18', 1)).toBe('2026-10-12');
    expect(startOfWeek('2026-10-21', 1)).toBe('2026-10-19');
    expect(weekDays('2026-10-21', 0)).toEqual(dayRange('2026-10-18', 7));
  });

  it('ordem das letras da semana', () => {
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe('monthGrid', () => {
  it('outubro de 2026 com semana no domingo: 5 linhas, começa em 27/09', () => {
    const grid = monthGrid('2026-10-18', 0);
    expect(grid).toHaveLength(5);
    expect(grid[0][0]).toBe('2026-09-27');
    expect(grid[0][4]).toBe('2026-10-01');
    expect(grid[4][6]).toBe('2026-10-31');
  });

  it('fevereiro de 2026 começando na segunda', () => {
    const grid = monthGrid('2026-02-10', 1);
    expect(grid[0][0]).toBe('2026-01-26');
    expect(grid.at(-1)!.at(-1)).toBe('2026-03-01');
    expect(grid.every((week) => week.length === 7)).toBe(true);
  });

  it('agosto de 2026 precisa de 6 linhas', () => {
    expect(monthGrid('2026-08-01', 0)).toHaveLength(6);
  });
});

describe('ocorrências por dia', () => {
  it('dia inteiro usa a data UTC e o fim exclusivo', () => {
    const allDay = event({
      allDay: true,
      startAt: '2026-10-18T00:00:00.000Z',
      endAt: '2026-10-20T00:00:00.000Z',
    });
    expect(occurrenceSpan(allDay, TZ)).toEqual({ first: '2026-10-18', last: '2026-10-19' });
  });

  it('com hora usa o fuso, e terminar à meia-noite não ocupa o dia seguinte', () => {
    // 21:00 → 00:00 em São Paulo (UTC-3).
    const late = event({ startAt: '2026-10-19T00:00:00.000Z', endAt: '2026-10-19T03:00:00.000Z' });
    expect(occurrenceSpan(late, TZ)).toEqual({ first: '2026-10-18', last: '2026-10-18' });
    expect(segmentOnDay(late, '2026-10-18', TZ)).toEqual({ start: 21 * 60, end: 1440 });
  });

  it('evento que atravessa a noite aparece nos dois dias, cortado', () => {
    // 22:00 do dia 18 → 02:00 do dia 19.
    const overnight = event({
      startAt: '2026-10-19T01:00:00.000Z',
      endAt: '2026-10-19T05:00:00.000Z',
    });
    const map = eventsByDay([overnight], ['2026-10-18', '2026-10-19', '2026-10-20'], TZ);
    expect(map.get('2026-10-18')).toHaveLength(1);
    expect(map.get('2026-10-19')).toHaveLength(1);
    expect(map.get('2026-10-20')).toHaveLength(0);
    expect(segmentOnDay(overnight, '2026-10-19', TZ)).toEqual({ start: 0, end: 120 });
  });

  it('ordena dia inteiro primeiro e depois por horário', () => {
    const a = event({
      title: 'Tarde',
      startAt: '2026-10-18T18:00:00.000Z',
      endAt: '2026-10-18T19:00:00.000Z',
    });
    const b = event({
      title: 'Manhã',
      startAt: '2026-10-18T12:00:00.000Z',
      endAt: '2026-10-18T13:00:00.000Z',
    });
    const c = event({
      title: 'Feriado',
      allDay: true,
      startAt: '2026-10-18T00:00:00.000Z',
      endAt: '2026-10-19T00:00:00.000Z',
    });
    const map = eventsByDay([a, b, c], ['2026-10-18'], TZ);
    expect(map.get('2026-10-18')!.map((e) => e.title)).toEqual(['Feriado', 'Manhã', 'Tarde']);
  });

  it('o dia do meio de um evento de vários dias com hora conta como dia inteiro', () => {
    const trip = event({ startAt: '2026-10-17T12:00:00.000Z', endAt: '2026-10-19T12:00:00.000Z' });
    expect(coversWholeDay(trip, '2026-10-18', TZ)).toBe(true);
    expect(coversWholeDay(trip, '2026-10-17', TZ)).toBe(false);
  });
});
