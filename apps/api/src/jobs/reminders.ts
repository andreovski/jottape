import { addDays, formatCents, startOfDayInZone } from '@jottape/finance-engine';

import { todayIn, toDbDate } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { listOccurrences } from '@/services/events';
import { sendPush } from '@/services/push';
import { claimDueReminders, refreshReminders } from '@/services/reminders';

/** Lembrete atrasado mais que isto (servidor fora do ar) não é mais mandado, só recalculado. */
const STALE_MS = 60 * 60_000;

function formatTime(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    instant
  );
}

function leadText(minutes: number) {
  if (minutes === 0) return 'agora';
  if (minutes < 60) return `em ${minutes} min`;
  if (minutes % 1440 === 0) return minutes === 1440 ? 'amanhã' : `em ${minutes / 1440} dias`;
  if (minutes % 60 === 0) return `em ${minutes / 60} h`;
  return `em ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export async function runReminders(now = new Date()) {
  const due = await claimDueReminders(now);
  let sent = 0;

  for (const reminder of due) {
    const fireAt = reminder.nextFireAt!;
    const occurrenceStart = new Date(fireAt.getTime() + reminder.minutesBefore * 60_000);
    const timeZone = reminder.user.timezone;

    // Marca antes de mandar: se o push falhar, não fica repetindo a cada minuto.
    await prisma.reminder.update({
      where: { id: reminder.id },
      data: { lastFiredFor: occurrenceStart, nextFireAt: null },
    });

    if (now.getTime() - fireAt.getTime() <= STALE_MS) {
      if (reminder.ownerType === 'EVENT') {
        const event = await prisma.event.findUnique({ where: { id: reminder.ownerId } });
        const cancelled = event
          ? await prisma.event.findFirst({
              where: {
                recurringEventId: event.id,
                originalStartAt: occurrenceStart,
                status: 'CANCELLED',
              },
            })
          : null;
        if (event && !cancelled) {
          await sendPush(reminder.userId, {
            title: event.title,
            body: event.allDay
              ? `Dia inteiro, ${leadText(reminder.minutesBefore)}`
              : `${formatTime(occurrenceStart, timeZone)} · ${leadText(reminder.minutesBefore)}${event.location ? ` · ${event.location}` : ''}`,
            url: '/agenda',
            tag: `event-${event.id}-${occurrenceStart.getTime()}`,
          });
          sent++;
        }
      } else {
        const task = await prisma.task.findUnique({ where: { id: reminder.ownerId } });
        if (task && !task.completedAt && !task.deletedAt) {
          await sendPush(reminder.userId, {
            title: task.title,
            body: task.hasTime
              ? `Tarefa para ${formatTime(occurrenceStart, timeZone)}`
              : 'Tarefa para hoje',
            url: '/tarefas',
            tag: `task-${task.id}`,
          });
          sent++;
        }
      }
    }

    await refreshReminders(reminder.ownerType, reminder.ownerId, new Date(now.getTime() + 1000));
  }
  return sent;
}

/** Resumo do dia no horário escolhido: eventos, tarefas e contas a pagar de hoje. */
export async function runDailySummaries(now = new Date()) {
  const users = await prisma.user.findMany({ where: { dailySummaryHour: { not: null } } });
  let sent = 0;

  for (const user of users) {
    const today = todayIn(user.timezone, now);
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: user.timezone,
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(now)
    );
    if (hour !== user.dailySummaryHour || user.lastDailySummaryDate === today) continue;

    await prisma.user.update({ where: { id: user.id }, data: { lastDailySummaryDate: today } });

    const start = startOfDayInZone(today, user.timezone);
    const end = startOfDayInZone(addDays(today, 1), user.timezone);
    const [events, tasks, bills] = await Promise.all([
      listOccurrences(user.id, start, end),
      prisma.task.count({
        where: { userId: user.id, completedAt: null, deletedAt: null, dueAt: { lt: end } },
      }),
      prisma.transaction.findMany({
        where: {
          userId: user.id,
          status: 'PLANNED',
          kind: 'EXPENSE',
          date: { lte: toDbDate(today) },
        },
      }),
    ]);
    if (events.length === 0 && tasks === 0 && bills.length === 0) continue;

    const parts = [];
    if (events.length)
      parts.push(`${events.length} ${events.length === 1 ? 'compromisso' : 'compromissos'}`);
    if (tasks) parts.push(`${tasks} ${tasks === 1 ? 'tarefa' : 'tarefas'}`);
    if (bills.length) {
      const total = bills.reduce((sum, b) => sum + b.amountCents, 0);
      parts.push(`${formatCents(total)} a pagar`);
    }
    const first = events.find((e) => !e.allDay);

    await sendPush(user.id, {
      title: 'Seu dia',
      body: `${parts.join(' · ')}${first ? `. Primeiro: ${first.title} às ${formatTime(new Date(first.startAt), user.timezone)}` : ''}`,
      url: '/',
      tag: `daily-${today}`,
    });
    sent++;
  }
  return sent;
}
