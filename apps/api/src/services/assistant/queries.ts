import { addDays, instantToWallTime, startOfDayInZone } from '@jottape/finance-engine';
import type { TaskView } from '@jottape/schemas';

import { fromDbDate, toDbDate } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { listOccurrences } from '@/services/events';
import { invoiceTotal, listAccounts } from '@/services/finance';
import { budgetStatuses, forecast } from '@/services/reports';
import { listTasks } from '@/services/tasks';

import { matchNames, summarizeLedger } from './summary';

// Consultas só de leitura que o Haiku chama para responder perguntas ("quanto gastei ontem com
// comida?"). Toda consulta filtra por userId e devolve JSON curto, com dinheiro em centavos.

export interface QueryContext {
  userId: string;
  timezone: string;
  today: string;
}

/** Período máximo de uma consulta de lançamentos ou de agenda. */
const MAX_DAYS = 400;

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

function period(input: Record<string, unknown>, today: string) {
  let from = isDate(input.de) ? input.de : today;
  let to = isDate(input.ate) ? input.ate : from;
  if (to < from) [from, to] = [to, from];
  if (addDays(from, MAX_DAYS) < to) to = addDays(from, MAX_DAYS);
  return { from, to };
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];

async function transactions(ctx: QueryContext, input: Record<string, unknown>) {
  const { from, to } = period(input, ctx.today);
  const kinds =
    input.tipo === 'despesa'
      ? (['EXPENSE'] as const)
      : input.tipo === 'receita'
        ? (['INCOME'] as const)
        : input.tipo === 'transferencia'
          ? (['TRANSFER'] as const)
          : (['INCOME', 'EXPENSE'] as const);

  const [categories, accounts] = await Promise.all([
    prisma.category.findMany({
      where: { userId: ctx.userId },
      select: { id: true, name: true, parentId: true },
    }),
    prisma.account.findMany({ where: { userId: ctx.userId }, select: { id: true, name: true } }),
  ]);

  const categoryNames = strings(input.categorias);
  const accountNames = strings(input.contas);
  const pickedCategories = matchNames(categories, categoryNames);
  const pickedAccounts = matchNames(accounts, accountNames);
  if (pickedCategories.missing.length || pickedAccounts.missing.length) {
    return {
      erro: 'Nome que não existe. Use um nome exato das listas abaixo.',
      categorias_nao_achadas: pickedCategories.missing,
      contas_nao_achadas: pickedAccounts.missing,
      categorias: categories.map((c) => c.name),
      contas: accounts.map((a) => a.name),
    };
  }
  // Categoria-mãe cobre as subcategorias.
  const categoryIds = new Set(pickedCategories.found.map((c) => c.id));
  for (const c of categories) if (c.parentId && categoryIds.has(c.parentId)) categoryIds.add(c.id);

  const search = typeof input.busca === 'string' ? input.busca.trim() : '';
  const rows = await prisma.transaction.findMany({
    where: {
      userId: ctx.userId,
      kind: { in: [...kinds] },
      date: { gte: toDbDate(from), lte: toDbDate(to) },
      ...(categoryNames.length ? { categoryId: { in: [...categoryIds] } } : {}),
      ...(accountNames.length ? { accountId: { in: pickedAccounts.found.map((a) => a.id) } } : {}),
      ...(search ? { description: { contains: search, mode: 'insensitive' as const } } : {}),
    },
    select: {
      id: true,
      date: true,
      createdAt: true,
      description: true,
      amountCents: true,
      kind: true,
      status: true,
      categoryId: true,
      accountId: true,
    },
  });
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  return {
    de: from,
    ate: to,
    ...summarizeLedger(
      rows.map((r) => ({
        id: r.id,
        date: fromDbDate(r.date),
        createdAt: r.createdAt.toISOString(),
        description: r.description,
        amountCents: r.amountCents,
        kind: r.kind,
        status: r.status,
        category: r.categoryId ? (categoryName.get(r.categoryId) ?? null) : null,
        account: accountName.get(r.accountId) ?? '',
      })),
      input.ordem === 'recentes' ? 'recentes' : 'valor'
    ),
  };
}

const ACCOUNT_TYPES = {
  WALLET: 'carteira',
  CHECKING: 'conta corrente',
  SAVINGS: 'poupança',
  CREDIT_CARD: 'cartão de crédito',
} as const;

async function accounts(ctx: QueryContext) {
  const rows = await listAccounts(ctx.userId);
  const cards = rows.filter((a) => a.type === 'CREDIT_CARD');
  const invoices = cards.length
    ? await prisma.creditCardInvoice.findMany({
        where: { userId: ctx.userId, accountId: { in: cards.map((c) => c.id) }, paidAt: null },
        include: { items: { select: { kind: true, amountCents: true } } },
        orderBy: { dueDate: 'asc' },
      })
    : [];
  return {
    contas: rows.map((a) => ({
      nome: a.name,
      tipo: ACCOUNT_TYPES[a.type],
      saldo_centavos: a.balanceCents,
      ...(a.type === 'CREDIT_CARD'
        ? {
            fatura_aberta_centavos: a.openInvoiceCents,
            faturas_nao_pagas: invoices
              .filter((i) => i.accountId === a.id)
              .slice(0, 3)
              .map((i) => ({
                vencimento: fromDbDate(i.dueDate),
                total_centavos: invoiceTotal(i.items),
              })),
          }
        : { saldo_com_previstos_ate_hoje_centavos: a.expectedBalanceCents }),
    })),
    saldo_total_centavos: rows
      .filter((a) => a.type !== 'CREDIT_CARD')
      .reduce((s, a) => s + a.balanceCents, 0),
  };
}

async function budgets(ctx: QueryContext, input: Record<string, unknown>) {
  const month =
    typeof input.mes === 'string' && /^\d{4}-\d{2}$/.test(input.mes)
      ? input.mes
      : ctx.today.slice(0, 7);
  const [rows, categories] = await Promise.all([
    budgetStatuses(ctx.userId, month),
    prisma.category.findMany({ where: { userId: ctx.userId }, select: { id: true, name: true } }),
  ]);
  const name = new Map(categories.map((c) => [c.id, c.name]));
  return {
    mes: month,
    orcamentos: rows.map((b) => ({
      categoria: name.get(b.categoryId) ?? '',
      limite_centavos: b.limitCents,
      gasto_centavos: b.spentCents,
      previsto_centavos: b.plannedCents,
      restante_centavos: b.limitCents - b.spentCents,
    })),
  };
}

async function balanceForecast(ctx: QueryContext, input: Record<string, unknown>) {
  const days = Math.min(365, Math.max(1, Number(input.dias) || 30));
  const result = await forecast(ctx.userId, days);
  const last = result.days.at(-1);
  // Só alguns pontos: o dia de hoje, o fim do período e o menor saldo total.
  const lowest = result.days.reduce<(typeof result.days)[number] | undefined>(
    (min, d) => (!min || d.totalCents < min.totalCents ? d : min),
    undefined
  );
  return {
    hoje: result.days[0] && {
      data: result.days[0].date,
      total_centavos: result.days[0].totalCents,
    },
    fim: last && { data: last.date, total_centavos: last.totalCents },
    menor_saldo: lowest && { data: lowest.date, total_centavos: lowest.totalCents },
    primeiro_dia_negativo: result.firstNegative?.date ?? null,
  };
}

function wallClock(iso: string, timezone: string) {
  const w = instantToWallTime(new Date(iso), timezone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${w.year}-${pad(w.month)}-${pad(w.day)}`,
    time: `${pad(w.hour)}:${pad(w.minute)}`,
  };
}

async function agenda(ctx: QueryContext, input: Record<string, unknown>) {
  const { from, to } = period(input, ctx.today);
  const occurrences = await listOccurrences(
    ctx.userId,
    startOfDayInZone(from, ctx.timezone),
    startOfDayInZone(addDays(to, 1), ctx.timezone)
  );
  return {
    de: from,
    ate: to,
    eventos: occurrences.slice(0, 60).map((o) => {
      // id + ocorrencia: o que a mudança precisa para mexer neste evento (ou só nesta ocorrência).
      const ids = { id: o.eventId, ocorrencia: o.isRecurring ? o.occurrenceStart : null };
      if (o.allDay) {
        return {
          ...ids,
          titulo: o.title,
          data: o.startAt.slice(0, 10),
          dia_inteiro: true,
          local: o.location,
        };
      }
      const start = wallClock(o.startAt, ctx.timezone);
      return {
        ...ids,
        titulo: o.title,
        data: start.date,
        inicio: start.time,
        fim: wallClock(o.endAt, ctx.timezone).time,
        local: o.location,
      };
    }),
  };
}

const TASK_VIEWS: Record<string, TaskView | undefined> = {
  hoje: 'today',
  proximos_7_dias: 'next7',
  atrasadas: 'overdue',
  sem_data: 'nodate',
  concluidas: 'completed',
};

async function tasks(ctx: QueryContext, input: Record<string, unknown>) {
  const lists = await prisma.taskList.findMany({
    where: { userId: ctx.userId },
    select: { id: true, name: true },
  });
  const listName = typeof input.lista === 'string' && input.lista.trim() ? input.lista : null;
  const list = listName ? matchNames(lists, [listName]) : null;
  if (list && list.found.length !== 1) {
    return { erro: 'Lista que não existe.', listas: lists.map((l) => l.name) };
  }
  const rows = await listTasks(ctx.userId, {
    view: TASK_VIEWS[String(input.visao)],
    listId: list?.found[0]?.id,
    search:
      typeof input.busca === 'string' && input.busca.trim() ? input.busca.slice(0, 80) : undefined,
  });
  const name = new Map(lists.map((l) => [l.id, l.name]));
  return {
    quantidade: rows.length,
    tarefas: rows.slice(0, 40).map((t) => ({
      id: t.id,
      titulo: t.title,
      lista: name.get(t.listId) ?? null,
      prazo: t.dueAt
        ? t.hasTime
          ? `${wallClock(t.dueAt, ctx.timezone).date} ${wallClock(t.dueAt, ctx.timezone).time}`
          : wallClock(t.dueAt, ctx.timezone).date
        : null,
      concluida: Boolean(t.completedAt),
    })),
  };
}

export const QUERY_HANDLERS: Record<
  string,
  (ctx: QueryContext, input: Record<string, unknown>) => Promise<unknown>
> = {
  lancamentos: transactions,
  contas: (ctx) => accounts(ctx),
  orcamentos: budgets,
  previsao_saldo: balanceForecast,
  agenda,
  tarefas: tasks,
};
