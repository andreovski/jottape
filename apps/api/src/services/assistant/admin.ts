import {
  type AssistantAdminResponse,
  type AssistantAdminUser,
  assistantBenchmarkCaseSchema,
  type AssistantBenchmarkRun,
  type AssistantDraft,
  assistantDraftSchema,
  type AssistantFeedbackItem,
  type AssistantIntent,
  assistantTestContextSchema,
  assistantTestExpectSchema,
  type AssistantTestExpect,
  type AssistantTrace,
  assistantTraceSchema,
  type CreateAssistantTestCaseBody,
  type UpdateAssistantTestCaseBody,
  type UpdateAssistantUserBody,
} from '@jottape/schemas';
import { z } from 'zod';

import { todayIn } from '@/lib/dates';
import { getAssistantMonthlyLimit, getJevConfig, getTranscriptionConfig } from '@/lib/env';
import { AppError, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { userTimezone } from '@/services/finance';

import {
  accessOf,
  HAIKU_INPUT,
  HAIKU_OUTPUT,
  isOwner,
  JEV_INPUT,
  optionsOf,
  RETENTION_DAYS,
  testContextOf,
} from '.';
import { runBenchmark, toTestCase } from './benchmark';

// Painel do beta (só o dono): quem usa o Assistente, quanto custa, quanto acerta, e os relatos de
// "Isso está errado".

const FEEDBACK_LIMIT = 50;
/** Rodadas do teste de acerto no histórico do painel. */
const RUNS_LIMIT = 5;
/** Falhas mostradas por pessoa. */
const FAILURES_LIMIT = 10;

export async function assertAdmin(userId: string) {
  if (!(await isOwner(userId))) throw new AppError(403, 'Só o dono do app vê o painel.');
}

const casesOf = (value: unknown) => {
  const parsed = z.array(assistantBenchmarkCaseSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
};

const traceOf = (value: unknown) => {
  const parsed = assistantTraceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export async function adminOverview(userId: string): Promise<AssistantAdminResponse> {
  await assertAdmin(userId);
  const timezone = await userTimezone(userId);
  const month = todayIn(timezone).slice(0, 7);
  const since = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const defaultLimit = getAssistantMonthlyLimit();

  const [users, usage, cards, messages, reports, feedback] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, assistantAccess: true, assistantLimit: true },
    }),
    prisma.assistantUsage.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000) } },
      select: { userId: true, kind: true, audioSeconds: true, costMicros: true, createdAt: true },
    }),
    prisma.assistantCard.findMany({
      where: { createdAt: { gte: since } },
      select: { userId: true, status: true, autoSaved: true, edited: true, corrections: true },
    }),
    prisma.assistantMessage.findMany({
      where: { role: 'ASSISTANT', createdAt: { gte: since }, trace: { not: undefined } },
      select: { userId: true, trace: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.assistantFeedback.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.assistantFeedback.findMany({
      orderBy: [{ resolvedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: FEEDBACK_LIMIT,
      include: { user: { select: { name: true } }, testCase: { select: { id: true } } },
    }),
  ]);
  const testCases = await prisma.assistantTestCase.findMany({ orderBy: { createdAt: 'desc' } });
  const runs = await prisma.assistantBenchmarkRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: RUNS_LIMIT,
  });

  const rows = users.map((user): AssistantAdminUser => {
    const access = accessOf(user);
    const mine = usage.filter(
      (u) => u.userId === user.id && todayIn(timezone, u.createdAt).slice(0, 7) === month
    );
    const myCards = cards.filter((c) => c.userId === user.id);
    const failed = { haiku: 0, jev: 0, answer: 0 };
    const failures: AssistantAdminUser['failures'] = [];
    for (const message of messages) {
      if (message.userId !== user.id) continue;
      for (const step of traceOf(message.trace)?.steps ?? []) {
        if (step.status !== 'failed') continue;
        if (step.engine === 'jev') failed.jev++;
        else if (step.engine === 'haiku') failed.haiku++;
        else failed.answer++;
        if (failures.length < FAILURES_LIMIT) {
          failures.push({
            engine: step.engine,
            error: step.error ?? null,
            at: message.createdAt.toISOString(),
          });
        }
      }
    }
    const corrections: Record<string, number> = {};
    for (const card of myCards) {
      for (const field of card.corrections) corrections[field] = (corrections[field] ?? 0) + 1;
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      access,
      limit: access === 'owner' ? null : (user.assistantLimit ?? defaultLimit),
      customLimit: user.assistantLimit,
      month: {
        requests: mine.filter((u) => u.kind === 'MESSAGE').length,
        transcriptions: mine.filter((u) => u.kind === 'TRANSCRIPTION').length,
        audioSeconds: Math.round(mine.reduce((s, u) => s + (u.audioSeconds ?? 0), 0)),
        costMicros: mine.reduce((s, u) => s + u.costMicros, 0),
      },
      recent: {
        cards: myCards.length,
        autoSaved: myCards.filter((c) => c.autoSaved).length,
        saved: myCards.filter((c) => c.status === 'SAVED').length,
        edited: myCards.filter((c) => c.edited).length,
        undone: myCards.filter((c) => c.status === 'UNDONE').length,
        discarded: myCards.filter((c) => c.status === 'DISCARDED').length,
        pending: myCards.filter((c) => c.status === 'DRAFT').length,
        haikuFailed: failed.haiku,
        jevFailed: failed.jev,
        answerFailed: failed.answer,
        reports: reports.find((r) => r.userId === user.id)?._count._all ?? 0,
      },
      corrections,
      failures,
    };
  });

  return {
    month,
    defaultLimit,
    services: { jev: getJevConfig() !== null, transcription: getTranscriptionConfig() !== null },
    // Quem tem acesso primeiro (o dono no topo), depois os outros por nome.
    users: rows.sort((a, b) => {
      const rank = (u: AssistantAdminUser) => ['owner', 'env', 'app', 'none'].indexOf(u.access);
      return rank(a) - rank(b) || a.name.localeCompare(b.name, 'pt-BR');
    }),
    feedback: await Promise.all(
      feedback.map(async (f): Promise<AssistantFeedbackItem> => {
        const cards = (Array.isArray(f.cards) ? f.cards : []).flatMap((draft) => {
          const parsed = assistantDraftSchema.safeParse(draft);
          return parsed.success ? [parsed.data] : [];
        });
        const trace = traceOf(f.trace);
        return {
          id: f.id,
          userName: f.user.name,
          request: f.request,
          reply: f.reply,
          values: f.values,
          trace,
          cards,
          note: f.note,
          createdAt: f.createdAt.toISOString(),
          resolvedAt: f.resolvedAt?.toISOString() ?? null,
          testCaseId: f.testCase?.id ?? null,
          suggestedCase: await suggestCase(f, cards, trace),
        };
      })
    ),
    testCases: testCases.flatMap((row) => {
      const parsed = toTestCase(row);
      return parsed ? [parsed] : [];
    }),
    runs: runs.map(
      (run): AssistantBenchmarkRun => ({
        id: run.id,
        source: run.source === 'CI' ? 'CI' : 'PANEL',
        commit: run.commit,
        label: run.label,
        regressions: run.regressions,
        ranAt: run.createdAt.toISOString(),
        total: run.total,
        passed: run.passed,
        autoSavedWrong: run.autoSavedWrong,
        autoSavedRight: casesOf(run.cases).filter((c) => c.autoSave && c.passed).length,
        ms: run.ms,
        costMicros: run.costMicros,
        cases: casesOf(run.cases),
      })
    ),
  };
}

const INTENT_BY_LABEL: Record<string, AssistantIntent> = {
  despesa: 'expense',
  receita: 'income',
  transferência: 'transfer',
  evento: 'event',
  tarefa: 'task',
  pergunta: 'question',
  mudança: 'change',
  outro: 'other',
};

const intentOf = (draft: AssistantDraft): AssistantIntent => {
  if (draft.type === 'transaction') {
    return draft.kind === 'INCOME' ? 'income' : draft.kind === 'TRANSFER' ? 'transfer' : 'expense';
  }
  return draft.type;
};

/**
 * O caso que o relato sugere: o pedido, o dia e o que o cartão montou (por nome). O dono corrige o
 * que estava errado antes de salvar. Relatos antigos, sem o contexto, usam as contas de hoje.
 */
async function suggestCase(
  feedback: {
    userId: string;
    request: string;
    today: string | null;
    timezone: string | null;
    context: unknown;
    createdAt: Date;
  },
  cards: AssistantDraft[],
  trace: AssistantTrace | null
): Promise<CreateAssistantTestCaseBody> {
  const timezone = feedback.timezone ?? (await userTimezone(feedback.userId));
  const options = await optionsOf(feedback.userId);
  const saved = assistantTestContextSchema.safeParse(feedback.context);
  const context = saved.success ? saved.data : testContextOf(options);
  const name = (rows: { id: string; name: string }[], id: string | null) =>
    rows.find((r) => r.id === id)?.name;

  const read = trace?.steps.find((s) => s.engine === 'haiku')?.detail ?? '';
  const intents = cards.length
    ? cards.map(intentOf)
    : read
        .split(', ')
        .map((label) => INTENT_BY_LABEL[label])
        .filter(Boolean);
  const expect: AssistantTestExpect = { intents: intents.length ? intents : ['other'] };
  const first = cards[0];
  if (first?.type === 'transaction') {
    Object.assign(expect, {
      ...(first.amountCents ? { amountCents: first.amountCents } : {}),
      date: first.date,
      account: name(options.accounts, first.accountId),
      ...(first.kind === 'TRANSFER'
        ? { toAccount: name(options.accounts, first.toAccountId) }
        : { category: name(options.categories, first.categoryId) }),
      ...(first.installments ? { installments: first.installments } : {}),
    });
  } else if (first?.type === 'event') {
    Object.assign(expect, {
      date: first.date,
      allDay: first.allDay,
      ...(first.allDay ? {} : { time: first.startTime }),
      ...(first.endTime ? { endTime: first.endTime } : {}),
      notes: Boolean(first.notes),
      repeat: first.rrule ?? null,
    });
  } else if (first?.type === 'task') {
    const inbox = options.lists.find((l) => l.isInbox)?.name ?? 'Entrada';
    Object.assign(expect, {
      date: first.date,
      ...(first.time ? { time: first.time } : {}),
      list: name(options.lists, first.listId) ?? inbox,
      notes: Boolean(first.notes),
      repeat: first.rrule ?? null,
      subtasks: first.subtasks?.length ?? 0,
    });
  }
  return {
    text: feedback.request,
    today: feedback.today ?? todayIn(timezone, feedback.createdAt),
    timezone,
    context,
    // Tira o que ficou indefinido (conta apagada, sem categoria).
    expect: assistantTestExpectSchema.parse(JSON.parse(JSON.stringify(expect))),
  };
}

/** Liga ou desliga o convite e muda o limite do mês. O dono e ASSISTANT_EMAILS não desligam aqui. */
export async function updateAssistantUser(
  userId: string,
  targetId: string,
  body: UpdateAssistantUserBody
) {
  await assertAdmin(userId);
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw notFound('Usuário');
  await prisma.user.update({
    where: { id: targetId },
    data: {
      ...(body.access !== undefined ? { assistantAccess: body.access } : {}),
      ...(body.limit !== undefined ? { assistantLimit: body.limit } : {}),
    },
  });
  return adminOverview(userId);
}

/** Marca o relato como visto (ou reabre). */
export async function resolveFeedback(userId: string, id: string, resolved: boolean) {
  await assertAdmin(userId);
  const feedback = await prisma.assistantFeedback.findUnique({ where: { id } });
  if (!feedback) throw notFound('Relato');
  await prisma.assistantFeedback.update({
    where: { id },
    data: { resolvedAt: resolved ? new Date() : null },
  });
  return adminOverview(userId);
}

export async function benchmark(userId: string) {
  await assertAdmin(userId);
  return runBenchmark(userId, {
    haikuInput: HAIKU_INPUT,
    haikuOutput: HAIKU_OUTPUT,
    jevInput: JEV_INPUT,
  });
}

/** Relato vira caso de teste (ou um caso escrito na mão). O relato fica resolvido. */
export async function createTestCase(userId: string, body: CreateAssistantTestCaseBody) {
  await assertAdmin(userId);
  const feedbackId = body.feedbackId ?? null;
  if (feedbackId) {
    const feedback = await prisma.assistantFeedback.findUnique({ where: { id: feedbackId } });
    if (!feedback) throw notFound('Relato');
  }
  const data = {
    text: body.text,
    today: body.today,
    timezone: body.timezone,
    context: body.context,
    expect: body.expect,
    active: true,
  };
  if (feedbackId) {
    await prisma.assistantTestCase.upsert({
      where: { feedbackId },
      create: { ...data, feedbackId },
      update: data,
    });
    await prisma.assistantFeedback.update({
      where: { id: feedbackId },
      data: { resolvedAt: new Date() },
    });
  } else {
    await prisma.assistantTestCase.create({ data });
  }
  return adminOverview(userId);
}

export async function updateTestCase(
  userId: string,
  id: string,
  body: UpdateAssistantTestCaseBody
) {
  await assertAdmin(userId);
  const found = await prisma.assistantTestCase.findUnique({ where: { id } });
  if (!found) throw notFound('Caso de teste');
  await prisma.assistantTestCase.update({ where: { id }, data: body });
  return adminOverview(userId);
}

export async function deleteTestCase(userId: string, id: string) {
  await assertAdmin(userId);
  await prisma.assistantTestCase.deleteMany({ where: { id } });
  return adminOverview(userId);
}

/** Tudo do painel num arquivo: relatos, casos, números por pessoa. */
export async function exportAdmin(userId: string) {
  return { exportedAt: new Date().toISOString(), ...(await adminOverview(userId)) };
}
