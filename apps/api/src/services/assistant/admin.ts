import {
  type AssistantAdminResponse,
  type AssistantAdminUser,
  assistantDraftSchema,
  type AssistantFeedbackItem,
  assistantTraceSchema,
  type UpdateAssistantUserBody,
} from '@jottape/schemas';

import { todayIn } from '@/lib/dates';
import { getAssistantMonthlyLimit, getJevConfig, getTranscriptionConfig } from '@/lib/env';
import { AppError, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { userTimezone } from '@/services/finance';

import { accessOf, HAIKU_INPUT, HAIKU_OUTPUT, isOwner, JEV_INPUT, RETENTION_DAYS } from '.';
import { runBenchmark } from './benchmark';

// Painel do beta (só o dono): quem usa o Assistente, quanto custa, quanto acerta, e os relatos de
// "Isso está errado".

const FEEDBACK_LIMIT = 50;

export async function assertAdmin(userId: string) {
  if (!(await isOwner(userId))) throw new AppError(403, 'Só o dono do app vê o painel.');
}

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
      select: { userId: true, status: true, autoSaved: true, edited: true },
    }),
    prisma.assistantMessage.findMany({
      where: { role: 'ASSISTANT', createdAt: { gte: since }, trace: { not: undefined } },
      select: { userId: true, trace: true },
    }),
    prisma.assistantFeedback.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.assistantFeedback.findMany({
      orderBy: [{ resolvedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: FEEDBACK_LIMIT,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const rows = users.map((user): AssistantAdminUser => {
    const access = accessOf(user);
    const mine = usage.filter(
      (u) => u.userId === user.id && todayIn(timezone, u.createdAt).slice(0, 7) === month
    );
    const myCards = cards.filter((c) => c.userId === user.id);
    const failed = { haiku: 0, jev: 0, answer: 0 };
    for (const message of messages) {
      if (message.userId !== user.id) continue;
      for (const step of traceOf(message.trace)?.steps ?? []) {
        if (step.status !== 'failed') continue;
        if (step.engine === 'jev') failed.jev++;
        else if (step.engine === 'haiku') failed.haiku++;
        else failed.answer++;
      }
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
    feedback: feedback.map(
      (f): AssistantFeedbackItem => ({
        id: f.id,
        userName: f.user.name,
        request: f.request,
        reply: f.reply,
        values: f.values,
        trace: traceOf(f.trace),
        cards: (Array.isArray(f.cards) ? f.cards : []).flatMap((draft) => {
          const parsed = assistantDraftSchema.safeParse(draft);
          return parsed.success ? [parsed.data] : [];
        }),
        note: f.note,
        createdAt: f.createdAt.toISOString(),
        resolvedAt: f.resolvedAt?.toISOString() ?? null,
      })
    ),
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
