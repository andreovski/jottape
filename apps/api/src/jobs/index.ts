import cron from 'node-cron';

import { prisma } from '@/lib/prisma';
import { extendRecurrences } from '@/services/finance';
import { syncAllCalendars } from '@/services/google/calendar';
import { syncTasks } from '@/services/google/tasks';

import { runDailySummaries, runReminders } from './reminders';

// Os jobs rodam dentro da API (uma instância só, sem dormir no Railway). Cada um tem uma trava
// para não sobrepor execuções quando uma demora mais que o intervalo.
function guarded(name: string, job: () => Promise<unknown>) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await job();
    } catch (error) {
      console.error(`[job:${name}]`, error);
    } finally {
      running = false;
    }
  };
}

async function eachGoogleUser(run: (userId: string) => Promise<void>) {
  const connections = await prisma.googleConnection.findMany({
    select: { userId: true },
    distinct: ['userId'],
  });
  for (const { userId } of connections) await run(userId);
}

export function startJobs() {
  cron.schedule(
    '* * * * *',
    guarded('reminders', () => runReminders())
  );
  cron.schedule(
    '* * * * *',
    guarded('daily-summary', () => runDailySummaries())
  );
  // O webhook avisa as mudanças do Calendar; isto é a rede de segurança (e renova os canais).
  cron.schedule(
    '*/15 * * * *',
    guarded('calendar', () => eachGoogleUser(syncAllCalendars))
  );
  cron.schedule(
    '*/5 * * * *',
    guarded('tasks', () => eachGoogleUser(syncTasks))
  );
  cron.schedule(
    '17 3 * * *',
    guarded('recurrences', () => extendRecurrences())
  );

  // Na subida: estende recorrências que ficaram para trás enquanto a API estava fora.
  void guarded('recurrences', () => extendRecurrences())();
}
