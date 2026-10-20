import { addDays, addMonthsToMonth, daysInMonth, startOfDayInZone } from '@jottape/finance-engine';
import {
  type BriefingItem,
  type BriefingPluginId,
  type BriefingResponse,
  type BriefingSettings,
  type BriefingSky,
  normalizeBriefingSettings,
} from '@jottape/schemas';
import type { Prisma } from '@prisma/client';

import { fromDbDate, todayIn, toDbDate } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { listOccurrences } from '@/services/events';
import { invoiceTotal, userTimezone } from '@/services/finance';
import { budgetStatuses, forecast } from '@/services/reports';

import * as external from './external';
import {
  balanceLine,
  billsLine,
  budgetLine,
  currencyLine,
  dayLine,
  freeWindow,
  holidayLine,
  invoiceClosingLine,
  type Line,
  line,
  monthLine,
  moonLine,
  quoteLine,
  signNames,
  staleLine,
  streakDays,
  streakLine,
  weatherLine,
  withPlugin,
  yesterdayLine,
} from './text';

export async function getBriefingSettings(userId: string): Promise<BriefingSettings> {
  const row = await prisma.briefingSettings.findUnique({ where: { userId } });
  return normalizeBriefingSettings(row?.settings);
}

export async function saveBriefingSettings(userId: string, settings: BriefingSettings) {
  const normalized = normalizeBriefingSettings(settings);
  const data = normalized as unknown as Prisma.InputJsonValue;
  await prisma.briefingSettings.upsert({
    where: { userId },
    create: { userId, settings: data },
    update: { settings: data },
  });
  return normalized;
}

interface Context {
  userId: string;
  timeZone: string;
  now: Date;
  today: string;
  dayStart: Date;
  dayEnd: Date;
  settings: BriefingSettings;
  /** Preenchido pelo plugin de clima. */
  sky: BriefingSky | null;
  /** Leituras divididas entre plugins (a agenda do dia serve a dois). */
  once<T>(key: string, load: () => Promise<T>): Promise<T>;
}

const SETTINGS_HREF = '/ajustes/briefing';

const eventsToday = (ctx: Context) =>
  ctx.once('events', () => listOccurrences(ctx.userId, ctx.dayStart, ctx.dayEnd));

const openTaskWhere = (userId: string): Prisma.TaskWhereInput => ({
  userId,
  deletedAt: null,
  parentTaskId: null,
  completedAt: null,
});

type Plugin = (ctx: Context) => Promise<Line | Line[] | null>;

const plugins: Record<BriefingPluginId, Plugin> = {
  async day(ctx) {
    const [events, tasks, overdue] = await Promise.all([
      eventsToday(ctx),
      prisma.task.count({ where: { ...openTaskWhere(ctx.userId), dueAt: { lt: ctx.dayEnd } } }),
      prisma.task.count({ where: { ...openTaskWhere(ctx.userId), dueAt: { lt: ctx.dayStart } } }),
    ]);
    return dayLine({ events, tasks, overdue, now: ctx.now, timeZone: ctx.timeZone });
  },

  async free(ctx) {
    return freeWindow(await eventsToday(ctx), ctx.today, ctx.now, ctx.timeZone);
  },

  async bills(ctx) {
    const { userId, today } = ctx;
    const weekEnd = addDays(today, 6);
    const [planned, overdue, invoices] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          userId,
          status: 'PLANNED',
          kind: 'EXPENSE',
          invoiceId: null,
          date: { gte: toDbDate(today), lte: toDbDate(weekEnd) },
        },
      }),
      prisma.transaction.count({
        where: {
          userId,
          status: 'PLANNED',
          kind: 'EXPENSE',
          invoiceId: null,
          date: { lt: toDbDate(today) },
        },
      }),
      prisma.creditCardInvoice.findMany({
        where: {
          userId,
          paidAt: null,
          OR: [
            { dueDate: { gte: toDbDate(today), lte: toDbDate(weekEnd) } },
            { closingDate: { gte: toDbDate(today), lte: toDbDate(addDays(today, 2)) } },
          ],
        },
        include: { items: { select: { kind: true, amountCents: true } }, account: true },
      }),
    ]);

    const bills = planned.map((tx) => ({
      description: tx.description,
      amountCents: tx.amountCents,
      date: fromDbDate(tx.date),
    }));
    const closing: Line[] = [];
    for (const invoice of invoices) {
      const total = invoiceTotal(invoice.items);
      if (total <= 0) continue;
      const due = fromDbDate(invoice.dueDate);
      const closes = fromDbDate(invoice.closingDate);
      if (due >= today && due <= weekEnd) {
        bills.push({
          description: `Fatura ${invoice.account.name}`,
          amountCents: total,
          date: due,
        });
      } else if (closes >= today) {
        closing.push(
          invoiceClosingLine(
            { accountName: invoice.account.name, closingDate: closes, totalCents: total },
            today
          )
        );
      }
    }
    const summary = billsLine(bills, overdue, today);
    return [...(summary ? [summary] : []), ...closing];
  },

  async balance(ctx) {
    const result = await forecast(ctx.userId, 60);
    return balanceLine(result.firstNegative, ctx.today);
  },

  async budget(ctx) {
    const month = ctx.today.slice(0, 7);
    const [statuses, categories] = await Promise.all([
      budgetStatuses(ctx.userId, month),
      prisma.category.findMany({ where: { userId: ctx.userId }, select: { id: true, name: true } }),
    ]);
    const names = new Map(categories.map((c) => [c.id, c.name]));
    const [year, m] = month.split('-').map(Number);
    return budgetLine(
      statuses.map((s) => ({
        name: names.get(s.categoryId) ?? 'Categoria',
        ratio: s.ratio,
        spentCents: s.spentCents,
        limitCents: s.limitCents,
      })),
      daysInMonth(year, m) - Number(ctx.today.slice(8))
    );
  },

  async stale(ctx) {
    const [overdue, undated] = await Promise.all([
      prisma.task.findFirst({
        where: { ...openTaskWhere(ctx.userId), dueAt: { lt: ctx.dayStart } },
        orderBy: { dueAt: 'asc' },
      }),
      prisma.task.findFirst({
        where: { ...openTaskWhere(ctx.userId), dueAt: null },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return staleLine(
      overdue?.dueAt ? { title: overdue.title, due: todayIn(ctx.timeZone, overdue.dueAt) } : null,
      undated ? { title: undated.title, created: todayIn(ctx.timeZone, undated.createdAt) } : null,
      ctx.today
    );
  },

  async yesterday(ctx) {
    const yesterday = addDays(ctx.today, -1);
    const start = startOfDayInZone(yesterday, ctx.timeZone);
    const [done, spent] = await Promise.all([
      prisma.task.count({
        where: {
          userId: ctx.userId,
          deletedAt: null,
          completedAt: { gte: start, lt: ctx.dayStart },
        },
      }),
      prisma.transaction.aggregate({
        where: { userId: ctx.userId, kind: 'EXPENSE', status: 'DONE', date: toDbDate(yesterday) },
        _sum: { amountCents: true },
      }),
    ]);
    return yesterdayLine(done, spent._sum.amountCents ?? 0);
  },

  async month(ctx) {
    const month = ctx.today.slice(0, 7);
    const previous = addMonthsToMonth(month, -1);
    const [py, pm] = previous.split('-').map(Number);
    const day = Math.min(Number(ctx.today.slice(8)), daysInMonth(py, pm));
    const total = async (first: string, last: string) =>
      (
        await prisma.transaction.aggregate({
          where: {
            userId: ctx.userId,
            kind: 'EXPENSE',
            status: 'DONE',
            date: { gte: toDbDate(first), lte: toDbDate(last) },
          },
          _sum: { amountCents: true },
        })
      )._sum.amountCents ?? 0;
    const [current, before] = await Promise.all([
      total(`${month}-01`, ctx.today),
      total(`${previous}-01`, `${previous}-${String(day).padStart(2, '0')}`),
    ]);
    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(
      new Date(`${previous}-15T12:00:00Z`)
    );
    return monthLine(current, before, monthName);
  },

  async streak(ctx) {
    const since = startOfDayInZone(addDays(ctx.today, -61), ctx.timeZone);
    const [due, completed] = await Promise.all([
      prisma.task.findMany({
        where: {
          userId: ctx.userId,
          deletedAt: null,
          parentTaskId: null,
          dueAt: { gte: since, lt: ctx.dayEnd },
        },
        select: { dueAt: true, completedAt: true },
      }),
      prisma.task.findMany({
        where: { userId: ctx.userId, deletedAt: null, completedAt: { gte: since } },
        select: { completedAt: true },
      }),
    ]);
    const day = (instant: Date) => todayIn(ctx.timeZone, instant);
    const days = streakDays(
      due.map((t) => ({ day: day(t.dueAt!), doneDay: t.completedAt ? day(t.completedAt) : null })),
      new Set(completed.map((t) => day(t.completedAt!))),
      ctx.today
    );
    return streakLine(days);
  },

  async weather(ctx) {
    const city = ctx.settings.city;
    if (!city) return line('Escolha a sua cidade para ver o clima aqui.', { href: SETTINGS_HREF });
    const weather = await external.weather(city, ctx.timeZone);
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: ctx.timeZone,
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(ctx.now)
    );
    ctx.sky = {
      code: weather.code,
      temperature: weather.current,
      isDay: weather.isDay ?? (hour >= 6 && hour < 18),
    };
    return weatherLine(city.name, weather);
  },

  async horoscope(ctx) {
    const sign = ctx.settings.sign;
    if (!sign)
      return line('Escolha o seu signo para ver o horóscopo do dia.', { href: SETTINGS_HREF });
    const { pt, symbol } = signNames[sign];
    return line(`${symbol} ${pt}: ${await external.horoscope(sign, ctx.today)}`);
  },

  async currency(ctx) {
    if (ctx.settings.currencies.length === 0) return null;
    return currencyLine(await external.rates(ctx.settings.currencies, ctx.today));
  },

  async holidays(ctx) {
    const year = Number(ctx.today.slice(0, 4));
    const list = await external.holidays(year);
    // Em novembro e dezembro, os do começo do ano seguinte também contam.
    const next =
      Number(ctx.today.slice(5, 7)) >= 11 ? await external.holidays(year + 1).catch(() => []) : [];
    return holidayLine([...list, ...next], ctx.today);
  },

  async moon(ctx) {
    return moonLine(ctx.now);
  },

  async quote(ctx) {
    return quoteLine(ctx.today);
  },
};

/**
 * Briefing do dia: roda os plugins ligados na ordem escolhida. Plugin que falha (serviço de fora
 * fora do ar, por exemplo) só fica de fora.
 */
export async function buildBriefing(
  userId: string,
  options: { now?: Date; log?: (error: unknown, plugin: string) => void } = {}
): Promise<BriefingResponse> {
  const now = options.now ?? new Date();
  const [timeZone, settings] = await Promise.all([
    userTimezone(userId),
    getBriefingSettings(userId),
  ]);
  const today = todayIn(timeZone, now);
  const memo = new Map<string, Promise<unknown>>();
  const ctx: Context = {
    userId,
    timeZone,
    now,
    today,
    dayStart: startOfDayInZone(today, timeZone),
    dayEnd: startOfDayInZone(addDays(today, 1), timeZone),
    settings,
    sky: null,
    once: <T>(key: string, load: () => Promise<T>) => {
      if (!memo.has(key)) memo.set(key, load());
      return memo.get(key) as Promise<T>;
    },
  };

  const enabled = settings.plugins.filter((p) => p.enabled).map((p) => p.id);
  const results = await Promise.all(
    enabled.map(async (id): Promise<BriefingItem[]> => {
      try {
        const result = await plugins[id](ctx);
        if (!result) return [];
        return withPlugin(id, Array.isArray(result) ? result : [result]);
      } catch (error) {
        options.log?.(error, id);
        return [];
      }
    })
  );
  return { date: today, items: results.flat(), sky: ctx.sky };
}

/** Próximo compromisso a partir de `from`, olhando até 90 dias à frente, de 30 em 30. */
export async function nextEvent(userId: string, from: Date) {
  // Dia inteiro é guardado em meia-noite UTC: compara pela data no fuso do usuário.
  const fromDay = todayIn(await userTimezone(userId), from);
  for (let window = 0; window < 3; window++) {
    const start = new Date(from.getTime() + window * 30 * 86_400_000);
    const end = new Date(start.getTime() + 30 * 86_400_000);
    const events = (await listOccurrences(userId, start, end))
      .filter((e) => (e.allDay ? e.startAt.slice(0, 10) >= fromDay : new Date(e.startAt) >= from))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    if (events.length) return events[0];
  }
  return null;
}
