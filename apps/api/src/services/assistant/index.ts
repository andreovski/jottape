import {
  type AssistantCardResponse,
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
  getAssistantEmails,
  getAssistantMonthlyLimit,
  getOwner,
  getTranscriptionConfig,
} from '@/lib/env';
import { AppError, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { userTimezone } from '@/services/finance';
import { toTransaction } from '@/services/serializers';

import { answerQuestion } from './answer';
import {
  type Created,
  createFromDraft,
  loadCreated,
  missingOf,
  NOTHING,
  removeCreated,
} from './create';
import { extractItems } from './haiku';
import { askJev } from './jev';
import {
  type AccountOption,
  type CategoryOption,
  type ExtractedItem,
  type FinanceIntent,
  type Intent,
  isActionIntent,
  isFinanceIntent,
  type Resolution,
  resolveEvent,
  resolveItem,
  resolveTask,
  type TaskListOption,
} from './resolve';
import { type CardOutcome, extractMoney, READ_FAILED, replyText, restoreMoney } from './text';
import { transcribe } from './transcribe';

/** Itens por pedido: o resto é ignorado (o Haiku pode exagerar). */
const MAX_ITEMS = 5;
/** Mensagens que voltam com a tela. */
const HISTORY = 60;
/** Mensagens anteriores que vão junto com uma pergunta ("e anteontem?"). */
const QUESTION_HISTORY = 6;
/** A conversa some depois disto (job diário). */
export const RETENTION_DAYS = 30;

// Custo estimado, em milionésimos de dólar por token (= US$ por milhão de tokens).
const HAIKU_INPUT = 0.1;
const HAIKU_OUTPUT = 0.5;
const JEV_INPUT = 0.042;
/** whisper-large-v3-turbo na Groq: US$ 0,04 por hora, cobrando no mínimo 10 s por áudio. */
const TRANSCRIPTION_PER_SECOND = (0.04 / 3600) * 1_000_000;
const TRANSCRIPTION_MIN_SECONDS = 10;

export interface Logger {
  warn: (error: unknown, message: string) => void;
}

async function userEmail(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email.toLowerCase() ?? null;
}

/** Ligado com a chave da Anthropic, só para o dono e os e-mails de ASSISTANT_EMAILS (beta). */
export async function assistantEnabled(userId: string) {
  if (!getAnthropicConfig()) return false;
  const email = await userEmail(userId);
  if (!email) return false;
  return email === getOwner()?.email || getAssistantEmails().includes(email);
}

async function assertEnabled(userId: string) {
  if (!(await assistantEnabled(userId))) {
    throw new AppError(503, 'O Assistente não está disponível.');
  }
}

// ---------------------------------------------------------------- uso

async function isOwner(userId: string) {
  const owner = getOwner();
  if (!owner) return false;
  return (await userEmail(userId)) === owner.email;
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

  return Promise.all(
    messages.map(
      async (message): Promise<AssistantMessageResponse> => ({
        id: message.id,
        role: message.role,
        text: message.text,
        values: message.values,
        createdAt: message.createdAt.toISOString(),
        cards: await Promise.all(
          [...message.cards]
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map(
              async (card): Promise<AssistantCardResponse> => ({
                id: card.id,
                status: card.status,
                score: card.score,
                draft: assistantDraftSchema.parse(card.draft),
                missing: card.missing as AssistantMissing[],
                uncertain: card.uncertain as AssistantUncertain[],
                transactions: card.transactionIds.flatMap((id) => byId.get(id) ?? []),
                ...(await loadCreated(userId, card)),
              })
            )
        ),
      })
    )
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
    enabled: await assistantEnabled(userId),
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

interface PlannedCard {
  resolution: Resolution;
  created: Created;
}

export async function sendMessage(
  userId: string,
  text: string,
  log: Logger
): Promise<{ messages: AssistantMessageResponse[]; usage: AssistantUsageResponse }> {
  await assertEnabled(userId);
  const timezone = await userTimezone(userId);
  await assertWithinLimit(userId, timezone);

  const today = todayIn(timezone);
  const [accountRows, categoryRows, listRows] = await Promise.all([
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
    prisma.taskList.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, isInbox: true },
    }),
  ]);
  const accounts: AccountOption[] = accountRows;
  const categories: CategoryOption[] = categoryRows;
  const lists: TaskListOption[] = listRows;

  const userMessage = await prisma.assistantMessage.create({
    data: { userId, role: 'USER', text },
  });

  let items: ExtractedItem[] | null = null;
  const cost = { modelInput: 0, modelOutput: 0, jevInput: 0 };
  try {
    const extracted = await extractItems(text, { today, timezone, accounts, categories, lists });
    items = extracted.items;
    cost.modelInput = extracted.inputTokens;
    cost.modelOutput = extracted.outputTokens;
  } catch (error) {
    log.warn(error, 'assistente: leitura do pedido falhou');
  }

  const planned: PlannedCard[] = [];
  const otherIntents: Intent[] = [];
  if (items) {
    const actions = items.filter((item) => isActionIntent(item.intent)).slice(0, MAX_ITEMS);
    otherIntents.push(...items.filter((i) => !isActionIntent(i.intent)).map((i) => i.intent));

    const usualAccountId = actions.some((item) => isFinanceIntent(item.intent))
      ? await usualAccount(userId, accounts)
      : null;
    const resolutions = await Promise.all(
      actions.map(async (item) => {
        const jev = await askJev(item, { accounts, categories, lists }).catch((error) => {
          log.warn(error, 'assistente: Jev falhou');
          return null;
        });
        cost.jevInput += jev?.inputTokens ?? 0;
        const answers = jev?.answers ?? null;
        if (item.intent === 'event') return resolveEvent({ item, jev: answers, today });
        if (item.intent === 'task') return resolveTask({ item, lists, jev: answers, today });
        return resolveItem({
          item: item as ExtractedItem & { intent: FinanceIntent },
          accounts,
          categories,
          jev: answers,
          today,
          usualAccountId,
        });
      })
    );

    // Salva em ordem, um por vez (cada um abre a sua transação no banco).
    for (const resolution of resolutions) {
      let created = NOTHING;
      if (resolution.autoSave) {
        try {
          created = (await createFromDraft(userId, resolution.draft, timezone)) ?? NOTHING;
        } catch (error) {
          log.warn(error, 'assistente: salvar sozinho falhou');
        }
      }
      planned.push({ resolution, created });
    }
  }

  // Perguntas: o Haiku consulta os dados e responde (dinheiro como {n} + values).
  let answer: { text: string; values: number[] } | null = null;
  if (otherIntents.includes('question')) {
    try {
      const previous = await prisma.assistantMessage.findMany({
        where: { userId, createdAt: { lt: userMessage.createdAt } },
        orderBy: { createdAt: 'desc' },
        take: QUESTION_HISTORY,
        select: { role: true, text: true, values: true },
      });
      const result = await answerQuestion(text, {
        userId,
        timezone,
        today,
        accounts,
        categories,
        lists,
        history: previous
          .reverse()
          .map((m) => ({ role: m.role, text: restoreMoney(m.text, m.values) })),
      });
      cost.modelInput += result.inputTokens;
      cost.modelOutput += result.outputTokens;
      if (result.text) answer = extractMoney(result.text);
    } catch (error) {
      log.warn(error, 'assistente: resposta da pergunta falhou');
    }
  }

  const isSaved = (created: Created) =>
    created.transactionIds.length > 0 || Boolean(created.eventId || created.taskId);
  const outcomes: CardOutcome[] = planned.map((p) => ({
    type: p.resolution.draft.type,
    saved: isSaved(p.created),
    missing: p.resolution.missing,
  }));
  const reply = items ? replyText(outcomes, otherIntents, answer?.text) : READ_FAILED;

  const assistantMessage = await prisma.assistantMessage.create({
    data: {
      userId,
      role: 'ASSISTANT',
      text: reply,
      values: answer?.values ?? [],
      // Um milissegundo depois do pedido, para a ordem não depender do relógio do banco.
      createdAt: new Date(userMessage.createdAt.getTime() + 1),
      cards: {
        create: planned.map((p, i) => ({
          userId,
          status: isSaved(p.created) ? 'SAVED' : 'DRAFT',
          score: p.resolution.score,
          draft: p.resolution.draft as unknown as Prisma.InputJsonValue,
          missing: p.resolution.missing,
          uncertain: p.resolution.uncertain,
          ...p.created,
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
  if (!card) throw notFound('Pedido do Assistente');
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
  if (card.status === 'DISCARDED') throw new AppError(409, 'Este pedido foi descartado.');

  const current = assistantDraftSchema.parse(card.draft);
  // As escolhas do cartão (conta, valor) só valem para lançamento.
  const draft =
    current.type === 'transaction' && body.draft ? { ...current, ...body.draft } : current;
  const created = await createFromDraft(userId, draft, await userTimezone(userId), body);
  if (!created) {
    await prisma.assistantCard.update({
      where: { id },
      data: { draft: draft as unknown as Prisma.InputJsonValue, missing: missingOf(draft) },
    });
    throw new AppError(400, 'Complete o pedido antes de salvar.');
  }

  await prisma.assistantCard.update({
    where: { id },
    data: {
      status: 'SAVED',
      draft: draft as unknown as Prisma.InputJsonValue,
      missing: [],
      uncertain: [],
      ...created,
    },
  });
  return cardResponse(userId, id);
}

/** Desfaz o que o Assistente salvou. */
export async function undoCard(userId: string, id: string): Promise<AssistantCardResponse> {
  const card = await ownedCard(userId, id);
  if (card.status !== 'SAVED') return cardResponse(userId, id);
  await removeCreated(userId, card);
  await prisma.assistantCard.update({ where: { id }, data: { status: 'UNDONE', ...NOTHING } });
  return cardResponse(userId, id);
}

export async function discardCard(userId: string, id: string): Promise<AssistantCardResponse> {
  const card = await ownedCard(userId, id);
  if (card.status === 'SAVED') throw new AppError(409, 'Desfaça antes de descartar.');
  await prisma.assistantCard.update({ where: { id }, data: { status: 'DISCARDED' } });
  return cardResponse(userId, id);
}

/** "Nova conversa": apaga as mensagens. O que foi salvo fica. */
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
  await assertEnabled(userId);
  if (!getTranscriptionConfig()) throw new AppError(503, 'A transcrição não está disponível.');
  await assertWithinLimit(userId, await userTimezone(userId));
  const text = await transcribe(audio, contentType);
  const audioSeconds = Math.max(0, Math.min(seconds, 120));
  await prisma.assistantUsage.create({
    data: {
      userId,
      kind: 'TRANSCRIPTION',
      audioSeconds,
      costMicros: Math.round(
        Math.max(audioSeconds, TRANSCRIPTION_MIN_SECONDS) * TRANSCRIPTION_PER_SECOND
      ),
    },
  });
  return text;
}
