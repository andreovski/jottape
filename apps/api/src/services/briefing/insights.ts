import { addMonthsToMonth, daysInMonth, diffInDays } from '@jottape/finance-engine';
import {
  type BriefingInsightsStatus,
  type BriefingTone,
  normalizeBriefingSettings,
} from '@jottape/schemas';
import type { FinanceInsight, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

import { todayIn, toDbDate } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { assistantEnabled, HAIKU_INPUT, HAIKU_OUTPUT, isOwner } from '@/services/assistant';
import { QUERY_HANDLERS, type QueryContext } from '@/services/assistant/queries';
import { extractMoney } from '@/services/assistant/text';
import { userTimezone } from '@/services/finance';

import { type ModelInsight, writeInsights } from './insights-model';
import { type Line, line } from './text';

// Insights de IA do briefing. Rotina limitada para o custo ficar previsível:
// - no máximo uma análise automática por dia, a partir das 5h no fuso do usuário;
// - só para quem abriu o briefing nos últimos 3 dias;
// - lançamentos e orçamentos iguais aos da última análise: reaproveita (até 7 dias);
// - o botão de atualizar vale uma vez por dia.

/** A rotina só gera a partir desta hora (no fuso do usuário). */
export const INSIGHTS_HOUR = 5;
/** Sem abrir o briefing há mais que isso, a rotina para. */
const ACTIVE_DAYS = 3;
/** Mesmo sem lançamento novo, a análise é refeita depois disto (o ritmo do mês muda). */
const MAX_AGE_DAYS = 7;
/** Do dia 1 ao 3, o mês corrente quase não tem dados: vale o fechamento do anterior. */
const CLOSE_DAYS = 3;
/** Com menos lançamentos que isso nos dois meses, não há o que analisar (e não chama a IA). */
const MIN_TRANSACTIONS = 5;

export type InsightKind = 'month' | 'close';

export interface StoredInsight {
  text: string;
  values: number[];
  tone: BriefingTone;
  question: string;
}

const TONES: Record<ModelInsight['tom'], BriefingTone> = {
  bom: 'good',
  neutro: 'neutral',
  atencao: 'warning',
  ruim: 'bad',
};

const pad = (n: number) => String(n).padStart(2, '0');

function lastDay(month: string) {
  const [year, m] = month.split('-').map(Number);
  return `${month}-${pad(daysInMonth(year, m))}`;
}

/** O que analisar hoje: o mês corrente até hoje, ou o fechamento do mês anterior no começo do mês. */
export function insightTarget(today: string): { kind: InsightKind; month: string } {
  const month = today.slice(0, 7);
  return Number(today.slice(8)) <= CLOSE_DAYS
    ? { kind: 'close', month: addMonthsToMonth(month, -1) }
    : { kind: 'month', month };
}

/** "5906900%", "1.250%": porcentagem de base quase zero, que só confunde. */
export function hasAbsurdPercent(text: string) {
  return [...text.matchAll(/(\d[\d.]*)(?:,\d+)?\s*%/g)].some(
    (m) => Number(m[1].replace(/\./g, '')) >= 1000
  );
}

/** O que o modelo escreveu, já com `{n}` + valores e a pergunta para o Assistente. */
export function toStored(insights: ModelInsight[]): StoredInsight[] {
  return insights
    .map((insight) => {
      const { text, values } = extractMoney(insight.texto.trim());
      return {
        text,
        values,
        tone: TONES[insight.tom],
        question: insight.pergunta.trim().slice(0, 120),
      };
    })
    .filter((insight) => insight.text.length > 0 && !hasAbsurdPercent(insight.text));
}

/** As frases do briefing: tocar abre o Assistente com a pergunta pronta. */
export function insightLines(items: StoredInsight[]): Line[] {
  // Filtra também o que já estava guardado antes da regra.
  return items
    .filter((item) => !hasAbsurdPercent(item.text))
    .map((item) =>
      line(item.text, {
        values: item.values,
        tone: item.tone,
        href: item.question
          ? `/assistente?pergunta=${encodeURIComponent(item.question)}`
          : '/financas',
      })
    );
}

function storedItems(row: FinanceInsight | null): StoredInsight[] {
  return Array.isArray(row?.items) ? (row.items as unknown as StoredInsight[]) : [];
}

// ---------------------------------------------------------------- dados

/** Muda quando um lançamento dos meses analisados ou um orçamento muda. */
async function fingerprint(userId: string, kind: InsightKind, month: string) {
  const first = `${addMonthsToMonth(month, -1)}-01`;
  const [transactions, budgets] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, date: { gte: toDbDate(first), lte: toDbDate(lastDay(month)) } },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.budget.aggregate({
      where: { userId },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
  ]);
  const parts = [
    kind,
    month,
    transactions._count._all,
    transactions._max.updatedAt?.toISOString() ?? '',
    budgets._count._all,
    budgets._max.updatedAt?.toISOString() ?? '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

const ledger = (ctx: QueryContext, de: string, ate: string) =>
  QUERY_HANDLERS.lancamentos(ctx, {
    de,
    ate,
    tipo: 'todos',
    categorias: null,
    contas: null,
    busca: null,
  }) as Promise<{ quantidade: number } & Record<string, unknown>>;

/** Só os totais, sem a lista de itens (o mês inteiro de antes serve de régua). */
function totalsOnly(summary: Record<string, unknown>) {
  const { itens: _items, itens_omitidos: _omitted, ...rest } = summary;
  return rest;
}

/** Os números que vão para o modelo, lidos pelas mesmas consultas do Assistente. */
async function snapshot(ctx: QueryContext, kind: InsightKind, month: string) {
  const previous = addMonthsToMonth(month, -1);
  if (kind === 'close') {
    const [closed, before, budgets] = await Promise.all([
      ledger(ctx, `${month}-01`, lastDay(month)),
      ledger(ctx, `${previous}-01`, lastDay(previous)),
      QUERY_HANDLERS.orcamentos(ctx, { mes: month }),
    ]);
    return {
      count: closed.quantidade + before.quantidade,
      data: {
        tipo: 'fechamento do mês',
        mes_fechado: { mes: month, ...closed },
        mes_antes: { mes: previous, ...totalsOnly(before) },
        orcamentos_do_mes_fechado: budgets,
      },
    };
  }

  const day = Number(ctx.today.slice(8));
  const [py, pm] = previous.split('-').map(Number);
  const samePoint = `${previous}-${pad(Math.min(day, daysInMonth(py, pm)))}`;
  const daysLeft = diffInDays(ctx.today, lastDay(month));
  const [current, before, beforeWhole, budgets, forecast] = await Promise.all([
    ledger(ctx, `${month}-01`, ctx.today),
    ledger(ctx, `${previous}-01`, samePoint),
    ledger(ctx, `${previous}-01`, lastDay(previous)),
    QUERY_HANDLERS.orcamentos(ctx, { mes: month }),
    QUERY_HANDLERS.previsao_saldo(ctx, { dias: Math.max(1, daysLeft) }),
  ]);
  return {
    count: current.quantidade + beforeWhole.quantidade,
    data: {
      tipo: 'mês corrente',
      dias_do_mes: daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5))),
      dias_passados: day,
      mes_atual_ate_hoje: { mes: month, ...current },
      mes_passado_ate_o_mesmo_dia: { mes: previous, ...totalsOnly(before) },
      mes_passado_inteiro: { mes: previous, ...totalsOnly(beforeWhole) },
      orcamentos_do_mes: budgets,
      previsao_de_saldo_ate_o_fim_do_mes: forecast,
    },
  };
}

// ---------------------------------------------------------------- rotina

/** Uma análise por usuário de cada vez (a rotina e o briefing podem pedir juntos). */
const running = new Map<string, Promise<void>>();

/**
 * Gera (ou reaproveita) a análise de hoje. `manual`: o botão de atualizar, que ignora o que já
 * foi feito hoje e refaz mesmo sem lançamento novo.
 */
export function ensureInsights(
  userId: string,
  options: { now?: Date; manual?: boolean } = {}
): Promise<void> {
  const current = running.get(userId);
  if (current) return current;
  const job = generate(userId, options).finally(() => running.delete(userId));
  running.set(userId, job);
  return job;
}

async function generate(userId: string, { now = new Date(), manual = false }) {
  const timezone = await userTimezone(userId);
  const today = todayIn(timezone, now);
  const { kind, month } = insightTarget(today);
  const row = await prisma.financeInsight.findUnique({ where: { userId } });
  if (!manual && row?.attemptedOn === today) return;

  const print = await fingerprint(userId, kind, month);
  const fresh =
    row?.generatedOn &&
    row.kind === kind &&
    row.period === month &&
    row.fingerprint === print &&
    diffInDays(row.generatedOn, today) < MAX_AGE_DAYS;
  if (!manual && fresh) {
    await prisma.financeInsight.update({ where: { userId }, data: { attemptedOn: today } });
    return;
  }

  // Marca antes de chamar: se falhar, só tenta de novo amanhã (ou pelo botão).
  await prisma.financeInsight.upsert({
    where: { userId },
    create: { userId, attemptedOn: today, ...(manual ? { refreshedOn: today } : {}) },
    update: { attemptedOn: today, ...(manual ? { refreshedOn: today } : {}) },
  });

  const ctx: QueryContext = { userId, timezone, today };
  const { count, data } = await snapshot(ctx, kind, month);
  let items: StoredInsight[] = [];
  let usage = { inputTokens: 0, outputTokens: 0 };
  if (count >= MIN_TRANSACTIONS) {
    const result = await writeInsights(data, { today, timezone, kind });
    items = toStored(result.insights);
    usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  }
  const costMicros = Math.round(
    usage.inputTokens * HAIKU_INPUT + usage.outputTokens * HAIKU_OUTPUT
  );

  await prisma.financeInsight.update({
    where: { userId },
    data: {
      kind,
      period: month,
      fingerprint: print,
      items: items as unknown as Prisma.InputJsonValue,
      generatedOn: today,
      generatedAt: now,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costMicros,
    },
  });
  if (usage.inputTokens > 0) {
    await prisma.assistantUsage.create({
      data: {
        userId,
        kind: 'INSIGHT',
        modelInputTokens: usage.inputTokens,
        modelOutputTokens: usage.outputTokens,
        costMicros,
      },
    });
  }
}

/**
 * O plugin do briefing: devolve a última análise e marca que o briefing foi aberto. Na primeira
 * vez, a análise começa em segundo plano e aparece na próxima abertura.
 */
export async function briefingInsights(
  userId: string,
  today: string,
  now: Date,
  log?: (error: unknown) => void
): Promise<Line[] | null> {
  if (!(await assistantEnabled(userId))) return null;
  const row = await prisma.financeInsight.upsert({
    where: { userId },
    create: { userId, viewedAt: now },
    update: { viewedAt: now },
  });
  if (!row.generatedOn) {
    if (row.attemptedOn === today) return null;
    void ensureInsights(userId, { now }).catch((error) => log?.(error));
    return [line('Preparando a análise dos seus gastos. Ela aparece aqui em instantes.')];
  }
  const items = storedItems(row);
  return items.length ? insightLines(items) : null;
}

/** Rotina de hora em hora: gera a análise do dia de quem abriu o briefing há pouco. */
export async function runInsights(now = new Date()) {
  const rows = await prisma.financeInsight.findMany({
    where: { viewedAt: { gte: new Date(now.getTime() - ACTIVE_DAYS * 86_400_000) } },
    select: { userId: true, attemptedOn: true },
  });
  for (const row of rows) {
    const timezone = await userTimezone(row.userId);
    if (row.attemptedOn === todayIn(timezone, now)) continue;
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(now)
    );
    if (hour < INSIGHTS_HOUR) continue;
    if (!(await assistantEnabled(row.userId))) continue;
    if (!(await pluginEnabled(row.userId))) continue;
    try {
      await ensureInsights(row.userId, { now });
    } catch (error) {
      console.error('[job:insights]', row.userId, error);
    }
  }
}

async function pluginEnabled(userId: string) {
  const row = await prisma.briefingSettings.findUnique({ where: { userId } });
  return normalizeBriefingSettings(row?.settings).plugins.some(
    (p) => p.id === 'insights' && p.enabled
  );
}

// ---------------------------------------------------------------- ajustes

export async function insightsStatus(
  userId: string,
  now = new Date()
): Promise<BriefingInsightsStatus> {
  const available = await assistantEnabled(userId);
  const row = available ? await prisma.financeInsight.findUnique({ where: { userId } }) : null;
  const today = todayIn(await userTimezone(userId), now);
  return {
    available,
    kind: (row?.kind as InsightKind | null) ?? null,
    period: row?.period ?? null,
    generatedAt: row?.generatedAt?.toISOString() ?? null,
    canRefresh: available && row?.refreshedOn !== today,
    cost:
      row?.generatedAt && (await isOwner(userId))
        ? {
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            costMicros: row.costMicros,
          }
        : null,
  };
}

/** O botão de atualizar: uma vez por dia, espera a análise ficar pronta. */
export async function refreshInsights(userId: string, now = new Date()) {
  const status = await insightsStatus(userId, now);
  if (!status.available) throw new AppError(503, 'Os insights de IA não estão disponíveis.');
  if (!status.canRefresh) {
    throw new AppError(429, 'Você já atualizou os insights hoje. Amanhã dá de novo.');
  }
  await ensureInsights(userId, { now, manual: true });
  return insightsStatus(userId, now);
}
