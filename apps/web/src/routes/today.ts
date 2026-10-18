import type { EventOccurrence } from '@jottape/schemas';

/** Saudação pela hora local. */
export function greeting(hour: number) {
  if (hour < 5) return 'Boa noite';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** O evento com horário que está acontecendo agora ou o próximo do dia; dia inteiro fica de fora. */
export function nextUpcoming(events: EventOccurrence[], now: Date) {
  return events
    .filter((e) => !e.allDay && new Date(e.endAt) > now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
}

/** Fração do anel: feitas sobre o total do dia; sem nada no dia, o anel fica vazio. */
export function taskProgress(done: number, open: number) {
  const total = done + open;
  return total === 0 ? 0 : done / total;
}
