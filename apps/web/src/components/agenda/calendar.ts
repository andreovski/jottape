import { addDays, dateStringToUtc, instantToWallTime, monthRange } from '@jottape/finance-engine';
import type { EventOccurrence } from '@jottape/schemas';

import { dayKey } from '@/lib/format';

export const DAY_MINUTES = 24 * 60;

/** 0 = domingo. */
export const weekdayOf = (key: string) => dateStringToUtc(key).getUTCDay();

/** Primeiro dia da semana que contém `key`, respeitando o dia em que a semana começa. */
export function startOfWeek(key: string, weekStartsOn: number) {
  return addDays(key, -((weekdayOf(key) - weekStartsOn + 7) % 7));
}

/** `count` dias seguidos a partir de `from`. */
export function dayRange(from: string, count: number) {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

export const weekDays = (key: string, weekStartsOn: number) =>
  dayRange(startOfWeek(key, weekStartsOn), 7);

/** Semanas (linhas de 7 dias) que cobrem o mês de `key`, com os dias vizinhos nas pontas. */
export function monthGrid(key: string, weekStartsOn: number): string[][] {
  const { first, last } = monthRange(key.slice(0, 7));
  const weeks: string[][] = [];
  for (let cursor = startOfWeek(first, weekStartsOn); cursor <= last; cursor = addDays(cursor, 7)) {
    weeks.push(dayRange(cursor, 7));
  }
  return weeks;
}

/** Letras dos dias da semana na ordem da semana do usuário (0 = domingo). */
export function weekdayOrder(weekStartsOn: number) {
  return Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
}

/**
 * Primeiro e último dia (inclusive) que a ocorrência ocupa. Dia inteiro: a API guarda meias-noites
 * UTC com o fim exclusivo, então o dia é a parte de data do ISO. Com hora: os dias no fuso.
 */
export function occurrenceSpan(
  event: Pick<EventOccurrence, 'allDay' | 'startAt' | 'endAt'>,
  timeZone: string
): { first: string; last: string } {
  if (event.allDay) {
    const first = event.startAt.slice(0, 10);
    const endExclusive = event.endAt.slice(0, 10);
    return { first, last: endExclusive > first ? addDays(endExclusive, -1) : first };
  }
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const first = dayKey(start, timeZone);
  // Termina à meia-noite em ponto: não ocupa o dia seguinte.
  const last = end > start ? dayKey(new Date(end.getTime() - 1), timeZone) : first;
  return { first, last: last < first ? first : last };
}

export function occursOn(
  event: Pick<EventOccurrence, 'allDay' | 'startAt' | 'endAt'>,
  key: string,
  timeZone: string
) {
  const { first, last } = occurrenceSpan(event, timeZone);
  return first <= key && key <= last;
}

/** Dia inteiro (ou que atravessa dias inteiros) primeiro, depois por início e maior duração. */
export function compareOccurrences(a: EventOccurrence, b: EventOccurrence) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (
    a.startAt.localeCompare(b.startAt) ||
    b.endAt.localeCompare(a.endAt) ||
    a.title.localeCompare(b.title, 'pt-BR')
  );
}

/** Ocorrências de cada dia de `days`, já ordenadas. */
export function eventsByDay(events: EventOccurrence[], days: string[], timeZone: string) {
  const map = new Map<string, EventOccurrence[]>(days.map((day) => [day, []]));
  if (!days.length) return map;
  const from = days[0];
  const to = days[days.length - 1];
  for (const event of events) {
    const span = occurrenceSpan(event, timeZone);
    const first = span.first < from ? from : span.first;
    const last = span.last > to ? to : span.last;
    for (let day = first; day <= last; day = addDays(day, 1)) map.get(day)?.push(event);
  }
  for (const list of map.values()) list.sort(compareOccurrences);
  return map;
}

/**
 * Trecho da ocorrência com hora dentro do dia, em minutos do relógio de parede (0–1440). Um evento
 * que vem de ontem começa em 0; um que segue amanhã termina em 1440.
 */
export function segmentOnDay(
  event: Pick<EventOccurrence, 'startAt' | 'endAt'>,
  key: string,
  timeZone: string
): { start: number; end: number } {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const minutesOf = (instant: Date) => {
    const wall = instantToWallTime(instant, timeZone);
    return wall.hour * 60 + wall.minute;
  };
  const startMin = dayKey(start, timeZone) < key ? 0 : minutesOf(start);
  const endKey = dayKey(end, timeZone);
  const endMin = endKey > key ? DAY_MINUTES : minutesOf(end);
  return { start: startMin, end: Math.max(startMin, endMin) };
}

/** Evento com hora que ocupa o dia inteiro (vem de antes e segue depois): vai para a faixa de cima. */
export function coversWholeDay(
  event: Pick<EventOccurrence, 'allDay' | 'startAt' | 'endAt'>,
  key: string,
  timeZone: string
) {
  if (event.allDay) return true;
  const { start, end } = segmentOnDay(event, key, timeZone);
  return start === 0 && end === DAY_MINUTES && occurrenceSpan(event, timeZone).first < key;
}

/** O mesmo dia da semana, `weeks` semanas para a frente (ou para trás). */
export function shiftWeek(key: string, weeks: number) {
  return addDays(key, weeks * 7);
}
