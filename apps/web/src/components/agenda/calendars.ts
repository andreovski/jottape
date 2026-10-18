import type { EventOccurrence, GoogleStatusResponse } from '@jottape/schemas';
import { useMemo } from 'react';

import { useGoogleStatus } from '@/features/google';

export const LOCAL_COLOR = 'var(--red)';

export interface CalendarInfo {
  id: string | null;
  name: string;
  color: string;
}

export function calendarsOf(status: GoogleStatusResponse | undefined) {
  const map = new Map<string, CalendarInfo>();
  for (const calendar of status?.calendars ?? []) {
    map.set(calendar.id, {
      id: calendar.id,
      name: calendar.name,
      color: calendar.color ?? 'var(--blue)',
    });
  }
  return map;
}

/** Calendário e cor de cada ocorrência: a do evento, senão a do calendário (Jottape = vermelho). */
export function useCalendars() {
  const status = useGoogleStatus();
  return useMemo(() => {
    const map = calendarsOf(status.data);
    const calendarOf = (event: Pick<EventOccurrence, 'calendarId' | 'source'>): CalendarInfo => {
      if (event.calendarId) {
        const found = map.get(event.calendarId);
        if (found) return found;
      }
      if (event.source === 'GOOGLE')
        return { id: event.calendarId, name: 'Google', color: 'var(--blue)' };
      return { id: null, name: 'Jottape', color: LOCAL_COLOR };
    };
    const colorOf = (event: Pick<EventOccurrence, 'calendarId' | 'source' | 'color'>) =>
      event.color ?? calendarOf(event).color;
    return { status: status.data, calendars: map, calendarOf, colorOf };
  }, [status.data]);
}

export type ColorOf = ReturnType<typeof useCalendars>['colorOf'];

export const occurrenceKey = (event: Pick<EventOccurrence, 'eventId' | 'occurrenceStart'>) =>
  `${event.eventId}:${event.occurrenceStart}`;
