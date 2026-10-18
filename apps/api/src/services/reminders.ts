import { nextEventOccurrence, startOfDayInZone } from '@jottape/finance-engine';
import type { Event, Reminder, ReminderOwner, Task } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/** Prazo só com dia: o lembrete conta a partir das 9h do dia. */
const DATE_ONLY_TASK_HOUR = 9;

export function taskAnchor(task: Pick<Task, 'dueAt' | 'hasTime'>, timeZone: string): Date | null {
  if (!task.dueAt) return null;
  if (task.hasTime) return task.dueAt;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(task.dueAt);
  return new Date(startOfDayInZone(day, timeZone).getTime() + DATE_ONLY_TASK_HOUR * 3_600_000);
}

/**
 * Início da próxima ocorrência do evento cujo lembrete ainda não passou, pulando a já disparada.
 * Para evento de dia inteiro o "início" é a meia-noite no fuso do usuário.
 */
export function nextEventStartForReminder(
  event: Pick<Event, 'startAt' | 'rrule' | 'allDay'>,
  minutesBefore: number,
  now: Date,
  timeZone: string,
  lastFiredFor: Date | null
): Date | null {
  const offset = minutesBefore * 60_000;
  const toLocal = (start: Date) =>
    event.allDay ? startOfDayInZone(start.toISOString().slice(0, 10), timeZone) : start;
  const zone = event.allDay ? 'UTC' : timeZone;

  if (!event.rrule) {
    const start = toLocal(event.startAt);
    if (lastFiredFor && lastFiredFor.getTime() === start.getTime()) return null;
    return start.getTime() - offset > now.getTime() - 60_000 ? start : null;
  }

  // Procura a partir de agora + antecedência (com folga de 1 min para o job atrasado).
  let after = new Date(now.getTime() + offset - 60_000 - (event.allDay ? 86_400_000 : 0));
  for (let i = 0; i < 5; i++) {
    const next = nextEventOccurrence(event.rrule, event.startAt, after, zone);
    if (!next) return null;
    const start = toLocal(next);
    const fired = lastFiredFor && lastFiredFor.getTime() >= start.getTime();
    if (!fired && start.getTime() - offset > now.getTime() - 60_000) return start;
    after = next;
  }
  return null;
}

async function ownerFireAt(
  reminder: Pick<Reminder, 'ownerType' | 'ownerId' | 'minutesBefore' | 'lastFiredFor'>,
  timeZone: string,
  now: Date
): Promise<Date | null> {
  const offset = reminder.minutesBefore * 60_000;

  if (reminder.ownerType === 'EVENT') {
    const event = await prisma.event.findUnique({ where: { id: reminder.ownerId } });
    if (!event || event.status === 'CANCELLED') return null;
    const start = nextEventStartForReminder(
      event,
      reminder.minutesBefore,
      now,
      timeZone,
      reminder.lastFiredFor
    );
    return start ? new Date(start.getTime() - offset) : null;
  }

  const task = await prisma.task.findUnique({ where: { id: reminder.ownerId } });
  if (!task || task.completedAt || task.deletedAt) return null;
  const anchor = taskAnchor(task, timeZone);
  if (!anchor) return null;
  if (reminder.lastFiredFor && reminder.lastFiredFor.getTime() === anchor.getTime()) return null;
  const fireAt = new Date(anchor.getTime() - offset);
  return fireAt.getTime() > now.getTime() - 60_000 ? fireAt : null;
}

/** Recalcula nextFireAt dos lembretes de um evento ou tarefa (depois de criar, editar, concluir). */
export async function refreshReminders(
  ownerType: ReminderOwner,
  ownerId: string,
  now = new Date()
) {
  const reminders = await prisma.reminder.findMany({
    where: { ownerType, ownerId },
    include: { user: { select: { timezone: true } } },
  });
  for (const reminder of reminders) {
    await prisma.reminder.update({
      where: { id: reminder.id },
      data: { nextFireAt: await ownerFireAt(reminder, reminder.user.timezone, now) },
    });
  }
}

export async function setReminders(
  userId: string,
  ownerType: ReminderOwner,
  ownerId: string,
  minutes: number[]
) {
  const unique = [...new Set(minutes)];
  await prisma.reminder.deleteMany({
    where: { ownerType, ownerId, minutesBefore: { notIn: unique } },
  });
  for (const minutesBefore of unique) {
    await prisma.reminder.upsert({
      where: { ownerType_ownerId_minutesBefore: { ownerType, ownerId, minutesBefore } },
      update: {},
      create: { userId, ownerType, ownerId, minutesBefore },
    });
  }
  await refreshReminders(ownerType, ownerId);
}

export async function remindersByOwner(ownerType: ReminderOwner, ownerIds: string[]) {
  const reminders = await prisma.reminder.findMany({
    where: { ownerType, ownerId: { in: ownerIds } },
    select: { ownerId: true, minutesBefore: true },
  });
  const map = new Map<string, number[]>();
  for (const r of reminders) {
    map.set(
      r.ownerId,
      [...(map.get(r.ownerId) ?? []), r.minutesBefore].sort((a, b) => a - b)
    );
  }
  return map;
}

export async function deleteReminders(ownerType: ReminderOwner, ownerIds: string[]) {
  await prisma.reminder.deleteMany({ where: { ownerType, ownerId: { in: ownerIds } } });
}

/** Lembretes vencidos: o job manda o push e recalcula o próximo. */
export async function claimDueReminders(now = new Date()) {
  return prisma.reminder.findMany({
    where: { nextFireAt: { lte: now } },
    include: { user: { select: { timezone: true } } },
    take: 200,
  });
}
