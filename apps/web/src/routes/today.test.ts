import type { EventOccurrence } from '@jottape/schemas';
import { describe, expect, it } from 'vitest';

import { greeting, nextUpcoming, taskProgress } from './today';

const event = (title: string, startAt: string, endAt: string, allDay = false) =>
  ({ title, startAt, endAt, allDay }) as EventOccurrence;

describe('tela Hoje', () => {
  it('saúda pela hora', () => {
    expect(greeting(3)).toBe('Boa noite');
    expect(greeting(9)).toBe('Bom dia');
    expect(greeting(14)).toBe('Boa tarde');
    expect(greeting(20)).toBe('Boa noite');
  });

  it('mostra o evento em andamento ou o próximo, sem os de dia inteiro', () => {
    const now = new Date('2026-10-18T13:30:00Z');
    const events = [
      event('Feriado', '2026-10-18T00:00:00Z', '2026-10-19T00:00:00Z', true),
      event('Passou', '2026-10-18T10:00:00Z', '2026-10-18T11:00:00Z'),
      event('Depois', '2026-10-18T16:00:00Z', '2026-10-18T17:00:00Z'),
      event('Agora', '2026-10-18T13:00:00Z', '2026-10-18T14:00:00Z'),
    ];
    expect(nextUpcoming(events, now)?.title).toBe('Agora');
    expect(nextUpcoming(events.slice(0, 2), now)).toBeUndefined();
  });

  it('calcula o anel das tarefas', () => {
    expect(taskProgress(0, 0)).toBe(0);
    expect(taskProgress(1, 3)).toBe(0.25);
    expect(taskProgress(2, 0)).toBe(1);
  });
});
