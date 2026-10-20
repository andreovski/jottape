import {
  type AssistantCardResponse,
  type AssistantDraft,
  assistantDraftSchema,
  type AssistantMessageResponse,
  type AssistantMissing,
  type AssistantStateResponse,
  type AssistantUncertain,
  type AssistantUsageResponse,
  type SaveAssistantCardBody,
} from '@jottape/schemas';
import type { AssistantCard, AssistantMessage, Prisma } from '@prisma/client';

import { todayIn } from '@/lib/dates';
import {
  getAnthropicConfig,
  getAssistantMonthlyLimit,
  getOwner,
  getTranscriptionConfig,
} from '@/lib/env';
import { AppError, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { createTransactions, userTimezone } from '@/services/finance';
import { toTransaction } from '@/services/serializers';

import { extractItems } from './haiku';
import { askJev } from './jev';
import {
  type AccountOption,
  type CategoryOption,
  type ExtractedItem,
  type FinanceIntent,
  type Intent,
  isFinanceIntent,
  type Resolution,
  resolveItem,
} from './resolve';
import { type CardOutcome, READ_FAILED, replyText } from './text';
import { transcribe } from './transcribe';

/** Itens de lançamento por pedido: o resto é ignorado (o Haiku pode exagerar). */
const MAX_ITEMS = 5;
/** Mensagens que voltam com a tela. */
const HISTORY = 60;
/** A conversa some depois disto (job diário). */
export const RETENTION_DAYS = 30;

// Custo estimado, em milionésimos de dólar por token (= US$ por milhão de tokens).
const HAIKU_INPUT = 0.1;
const HAIKU_OUTPUT = 0.5;
const JEV_INPUT = 0.042;
/** gpt-4o-mini-transcribe: US$ 0,003 por minuto. */
const TRANSCRIPTION_PER_SECOND = 50;

export interface Logger {
  warn: (error: unknown, message: string) => void;
}

export const assistantEnabled = () => getAnthropicConfig() !== null;

function assertEnabled() {
  if (!assistantEnabled()) throw new AppError(503, 'O Assistente não está disponível.');
}

// ---------------------------------------------------------------- uso

async function isOwner(userId: string) {
  const owner = getOwner();
  if (!owner) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email.toLowerCase() === owner.email;
}

/** Comandos no mês corrente (no fuso do usuário). O dono não tem limite. */
export async function usageOf(userId: string, timezone: string): Promise<AssistantUsageResponse> {
  const month = todayIn(timezone).slice(0, 7);
  const rows = await prisma.assistantUsage.findMany({
    where: {
      userId,
      kind: 'MESSAGE',
      createdAt: { gte: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000) },
    },
    select: { createdAt: true },
  });
  const used = rows.filter((row) => todayIn(timezone, row.createdAt).slice(0, 7) === month).length;
  return { used, limit: (await isOwner(userId)) ? null : getAssistantMonthlyLimit() };
}

async function assertWithinLimit(userId: string, timezone: string) {
  const usage = await usageOf(userId, timezone);
  if (usage.limit !== null && usage.used >= usage.limit) {
    throw new AppError(
      429,
      `Você usou os ${usage.limit} pedidos do mês. O limite volta no dia 1º.`
    );
  }
}

// ---------------------------------------------------------------- respostas

type MessageWithCards = AssistantMessage & { cards: AssistantCard[] };

async function toMessages(userId: string, messages: MessageWithCards[]) {
  const ids = messages.flatMap((m) => m.cards.flatMap((c) => c.transactionIds));
  const transactions =
    ids.length === 0
      ? []
      : await prisma.transaction.findMany({
          where: { userId, id: { in: ids } },
          include: { recurrence: { select: { rrule: true } } },
          orderBy: { date: 'asc' },
        });
  const byId = new Map(transactions.map((t) => [t.id, toTransaction(t)]));

  return messages.map(
    (message): AssistantMessageResponse => ({
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt.toISOString(),
      cards: [...message.cards]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(
          (card): AssistantCardResponse => ({
            id: card.id,
            status: card.status,
            score: card.score,
            draft: card.draft as unknown as AssistantDraft,
            missing: card.missing as AssistantMissing[],
            uncertain: card.uncertain as AssistantUncertain[],
            transactions: card.transactionIds.flatMap((id) => byId.get(id) ?? []),
          })
        ),
    })
  );
}

export async function assistantState(userId: string): Promise<AssistantStateResponse> {
  const timezone = await userTimezone(userId);
  const recent = await prisma.assistantMessage.findMany({
    where: { userId },
    include: { cards: true },
    orderBy: { createdAt: 'desc' },
    take: HISTORY,
  });
  return {
    enabled: assistantEnabled(),
    transcription: getTranscriptionConfig() !== null,
    usage: await usageOf(userId, timezone),
    messages: await toMessages(userId, recent.reverse()),
  };
}

// ---------------------------------------------------------------- pedido

/** A conta mais usada nos últimos 90 dias: sugestão quando o pedido não diz qual. */
async function usualAccount(userId: string, accounts: AccountOption[]): Promise<string | null> {
  if (accounts.length === 0) return null;
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await prisma.transaction.groupBy({
    by: ['accountId'],
    where: {
      userId,
      accountId: { in: accounts.map((a) => a.id) },
      kind: { not: 'TRANSFER' },
      createdAt: { gte: since },
    },
    _count: { _all: true },
    orderBy: { _count: { accountId: 'desc' } },
    take: 1,
  });
  return rows[0]?.accountId ?? null;
}

function toCreateBody(draft: AssistantDraft) {
  if (!draft.amountCents || !draft.accountId) return null;
  if (draft.kind === 'TRANSFER' && !draft.toAccountId) return null;
  return {
    kind: draft.kind,
    amountCents: draft.amountCents,
    date: draft.date,
    accountId: draft.accountId,
    toAccountId: draft.kind === 'TRANSFER' ? draft.toAccountId : null,
    categoryId: draft.kind === 'TRANSFER' ? null : draft.categoryId,
    description: draft.description,
    ...(draft.installments ? { installments: draft.installments } : {}),
  };
}

interface PlannedCard {
  resolution: Resolution;
  transactionIds: string[];
}

export async function sendMessage(
  userId: string,
  text: string,
  log: Logger
): Promise<{ messages: AssistantMessageResponse[]; usage: AssistantUsageResponse }> {
  assertEnabled();
  const timezone = await userTimezone(userId);
  await assertWithinLimit(userId, timezone);

  const today = todayIn(timezone);
  const [accountRows, categoryRows] = await Promise.all([
    prisma.account.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, type: true },
    }),
    prisma.category.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, kind: true },
    }),
  ]);
  const accounts: AccountOption[] = accountRows;
  const categories: CategoryOption[] = categoryRows;

  const userMessage = await prisma.assistantMessage.create({
    data: { userId, role: 'USER', text },
  });

  let items: ExtractedItem[] | null = null;
  const cost = { modelInput: 0, modelOutput: 0, jevInput: 0 };
  try {
    const extracted = await extractItems(text, { today, timezone, accounts, categories });
    items = extracted.items;
    cost.modelInput = extracted.inputTokens;
    cost.modelOutput = extracted.outputTokens;
  } catch (error) {
    log.warn(error, 'assistente: leitura do pedido falhou');
  }

  const planned: PlannedCard[] = [];
  const otherIntents: Intent[] = [];
  if (items) {
    const finance = items
      .filter((item): item is ExtractedItem & { intent: FinanceIntent } =>
        isFinanceIntent(item.intent)
      )
      .slice(0, MAX_ITEMS);
    otherIntents.push(...items.filter((i) => !isFinanceIntent(i.intent)).map((i) => i.intent));

    const usualAccountId = finance.length > 0 ? await usualAccount(userId, accounts) : null;
    const resolutions = await Promise.all(
      finance.map(async (item) => {
        const jev =
          accounts.length > 0
            ? await askJev(item, accounts, categories).catch((error) => {
                log.warn(error, 'assistente: Jev falhou');
                return null;
              })
            : null;
        cost.jevInput += jev?.inputTokens ?? 0;
        return resolveItem({
          item,
          accounts,
          categories,
          jev: jev?.answers ?? null,
          today,
          usualAccountId,
        });
      })
    );

    // Salva em ordem, um por vez (cada um abre a sua transação no banco).
    for (const resolution of resolutions) {
      const body = resolution.autoSave ? toCreateBody(resolution.draft) : null;
      let transactionIds: string[] = [];
      if (body) {
        try {
          transactionIds = (await createTransactions(userId, body)).map((t) => t.id);
        } catch (error) {
          log.warn(error, 'assistente: salvar sozinho falhou');
        }
      }
      planned.push({ resolution, transactionIds });
    }
  }

  const outcomes: CardOutcome[] = planned.map((p) => ({
    saved: p.transactionIds.length > 0,
    missing: p.resolution.missing,
  }));
  const reply = items ? replyText(outcomes, otherIntents) : READ_FAILED;

  const assistantMessage = await prisma.assistantMessage.create({
    data: {
      userId,
      role: 'ASSISTANT',
      text: reply,
      // Um milissegundo depois do pedido, para a ordem não depender do relógio do banco.
      createdAt: new Date(userMessage.createdAt.getTime() + 1),
      cards: {
        create: planned.map((p, i) => ({
          userId,
          status: p.transactionIds.length > 0 ? 'SAVED' : 'DRAFT',
          score: p.resolution.score,
          draft: p.resolution.draft as unknown as Prisma.InputJsonValue,
          missing: p.resolution.missing,
          uncertain: p.resolution.uncertain,
          transactionIds: p.transactionIds,
          createdAt: new Date(Date.now() + i),
        })),
      },
    },
  });

  // Pedido que nem foi lido não conta no limite.
  if (items) {
    await prisma.assistantUsage.create({
      data: {
        userId,
        kind: 'MESSAGE',
        jevInputTokens: cost.jevInput,
        modelInputTokens: cost.modelInput,
        modelOutputTokens: cost.modelOutput,
        costMicros: Math.round(
          cost.modelInput * HAIKU_INPUT +
            cost.modelOutput * HAIKU_OUTPUT +
            cost.jevInput * JEV_INPUT
        ),
      },
    });
  }

  const messages = await prisma.assistantMessage.findMany({
    where: { id: { in: [userMessage.id, assistantMessage.id] } },
    include: { cards: true },
    orderBy: { createdAt: 'asc' },
  });
  return {
    messages: await toMessages(userId, messages),
    usage: await usageOf(userId, timezone),
  };
}

// ---------------------------------------------------------------- cartões

async function ownedCard(userId: string, id: string) {
  const card = await prisma.assistantCard.findFirst({ where: { id, userId } });
  if (!card) throw notFound('Lançamento do Assistente');
  return card;
}

async function cardResponse(userId: string, id: string): Promise<AssistantCardResponse> {
  const message = await prisma.assistantMessage.findFirstOrThrow({
    where: { userId, cards: { some: { id } } },
    include: { cards: { where: { id } } },
  });
  const [response] = await toMessages(userId, [message]);
  return response.cards[0];
}

/** Salva o rascunho (ou o que foi desfeito), com o que o usuário trocou. */
export async function saveCard(
  userId: string,
  id: string,
  body: SaveAssistantCardBody
): Promise<AssistantCardResponse> {
  const card = await ownedCard(userId, id);
  if (card.status === 'SAVED') return cardResponse(userId, id);
  if (card.status === 'DISCARDED') throw new AppError(409, 'Este lançamento foi descartado.');

  const draft = assistantDraftSchema.parse({
    ...(card.draft as object),
    ...body.draft,
  });
  const create = toCreateBody(draft);
  if (!create) {
    const missing: AssistantMissing[] = [];
    if (!draft.amountCents) missing.push('amount');
    if (!draft.accountId) missing.push('account');
    if (draft.kind === 'TRANSFER' && !draft.toAccountId) missing.push('toAccount');
    await prisma.assistantCard.update({
      where: { id },
      data: { draft: draft as unknown as Prisma.InputJsonValue, missing },
    });
    throw new AppError(400, 'Complete o lançamento antes de salvar.');
  }

  const created = await createTransactions(userId, create);
  await prisma.assistantCard.update({
    where: { id },
    data: {
      status: 'SAVED',
      draft: draft as unknown as Prisma.InputJsonValue,
      missing: [],
      uncertain: [],
      transactionIds: created.map((t) => t.id),
    },
  });
  return cardResponse(userId, id);
}

/** Desfaz o que o Assistente salvou: apaga os lançamentos (todas as parcelas). */
export async function undoCard(userId: string, id: string): Promise<AssistantCardResponse> {
  const card = await ownedCard(userId, id);
  if (card.status !== 'SAVED') return cardResponse(userId, id);
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { userId, id: { in: card.transactionIds } } }),
    prisma.assistantCard.update({
      where: { id },
      data: { status: 'UNDONE', transactionIds: [] },
    }),
  ]);
  return cardResponse(userId, id);
}

export async function discardCard(userId: string, id: string): Promise<AssistantCardResponse> {
  const card = await ownedCard(userId, id);
  if (card.status === 'SAVED') throw new AppError(409, 'Desfaça o lançamento antes de descartar.');
  await prisma.assistantCard.update({ where: { id }, data: { status: 'DISCARDED' } });
  return cardResponse(userId, id);
}

/** "Nova conversa": apaga as mensagens. Os lançamentos salvos ficam. */
export async function clearConversation(userId: string) {
  await prisma.assistantMessage.deleteMany({ where: { userId } });
}

export async function pruneAssistantMessages(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.assistantMessage.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

// ---------------------------------------------------------------- voz

export async function transcribeAudio(
  userId: string,
  audio: Buffer,
  contentType: string,
  seconds: number
): Promise<string> {
  assertEnabled();
  if (!getTranscriptionConfig()) throw new AppError(503, 'A transcrição não está disponível.');
  await assertWithinLimit(userId, await userTimezone(userId));
  const text = await transcribe(audio, contentType);
  const audioSeconds = Math.max(0, Math.min(seconds, 120));
  await prisma.assistantUsage.create({
    data: {
      userId,
      kind: 'TRANSCRIPTION',
      audioSeconds,
      costMicros: Math.round(audioSeconds * TRANSCRIPTION_PER_SECOND),
    },
  });
  return text;
}
