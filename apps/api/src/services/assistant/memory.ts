import type { AssistantDraft, AssistantMemoryItem, SaveAssistantCardBody } from '@jottape/schemas';

import { notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

import {
  type AccountOption,
  type CategoryOption,
  type Hints,
  historyHints,
  mergeHints,
  normalize,
} from './resolve';

// Memória por pessoa: o que ela corrige no cartão (conta e categoria por descrição) e o que o
// histórico de lançamentos mostra. Entra no pedido como sugestão (resolve.ts) e nas instruções do
// Haiku. A pessoa vê e apaga em Ajustes.

/** Preferências que vão nas instruções do Haiku (as mais usadas). */
const PROMPT_LIMIT = 20;
/** Lançamentos com a mesma descrição olhados no histórico. */
const HISTORY_ROWS = 20;
const HISTORY_DAYS = 180;

type Field = 'account' | 'category';

export const phraseOf = (description: string) => normalize(description).slice(0, 80);

/** O que a pessoa costuma usar para cada descrição (memória primeiro, depois o histórico). */
export async function hintsFor(userId: string, descriptions: string[]) {
  const phrases = [...new Set(descriptions.map(phraseOf).filter(Boolean))];
  const result = new Map<string, Hints>();
  if (phrases.length === 0) return result;
  const memories = await prisma.assistantMemory.findMany({
    where: { userId, phrase: { in: phrases } },
  });
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  for (const phrase of phrases) {
    const memory: Hints = {};
    for (const m of memories.filter((m) => m.phrase === phrase)) {
      memory[m.field as Field] = { id: m.valueId, source: 'memory' };
    }
    const original = descriptions.find((d) => phraseOf(d) === phrase)!.trim();
    const rows = await prisma.transaction.findMany({
      where: {
        userId,
        kind: { not: 'TRANSFER' },
        description: { equals: original, mode: 'insensitive' },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_ROWS,
      select: { accountId: true, categoryId: true },
    });
    result.set(phrase, mergeHints(memory, historyHints(rows)));
  }
  return result;
}

/**
 * Aprende com o cartão salvo: conta ou categoria diferente do que o Jotta montou (trocada, ou
 * escolhida porque faltava) vira preferência para a descrição.
 */
export async function learnFromSave(
  userId: string,
  draft: AssistantDraft,
  body: SaveAssistantCardBody
) {
  if (draft.type !== 'transaction' || draft.kind === 'TRANSFER') return;
  const phrase = phraseOf(draft.description);
  const label = draft.description.trim().slice(0, 120);
  if (!phrase) return;
  const final = {
    account: body.transaction?.accountId ?? body.draft?.accountId ?? draft.accountId,
    category: body.transaction ? (body.transaction.categoryId ?? null) : draft.categoryId,
  };
  // Mudou o tipo (despesa virou receita): a correção não diz nada sobre a descrição.
  if (body.transaction && body.transaction.kind !== draft.kind) return;
  for (const field of ['account', 'category'] as const) {
    const before = field === 'account' ? draft.accountId : draft.categoryId;
    const after = final[field];
    if (!after || after === before) continue;
    const existing = await prisma.assistantMemory.findUnique({
      where: { userId_phrase_field: { userId, phrase, field } },
    });
    await prisma.assistantMemory.upsert({
      where: { userId_phrase_field: { userId, phrase, field } },
      create: { userId, phrase, label, field, valueId: after },
      update: {
        label,
        valueId: after,
        uses: existing?.valueId === after ? { increment: 1 } : 1,
      },
    });
  }
}

/** Reforça a memória quando o cartão é salvo como ela sugeriu. */
export async function reinforce(userId: string, draft: AssistantDraft) {
  if (draft.type !== 'transaction') return;
  const phrase = phraseOf(draft.description);
  if (!phrase) return;
  await prisma.assistantMemory.updateMany({
    where: {
      userId,
      phrase,
      OR: [
        { field: 'account', valueId: draft.accountId ?? '' },
        { field: 'category', valueId: draft.categoryId ?? '' },
      ],
    },
    data: { uses: { increment: 1 } },
  });
}

interface Named {
  label: string;
  account?: string;
  category?: string;
}

/** As preferências mais usadas, por nome, para as instruções do Haiku. */
export async function promptPreferences(
  userId: string,
  accounts: AccountOption[],
  categories: CategoryOption[]
): Promise<Named[]> {
  const rows = await prisma.assistantMemory.findMany({
    where: { userId },
    orderBy: [{ uses: 'desc' }, { updatedAt: 'desc' }],
    take: PROMPT_LIMIT * 2,
  });
  const byPhrase = new Map<string, Named>();
  for (const row of rows) {
    const name =
      row.field === 'account'
        ? accounts.find((a) => a.id === row.valueId)?.name
        : categories.find((c) => c.id === row.valueId)?.name;
    if (!name) continue;
    const entry = byPhrase.get(row.phrase) ?? { label: row.label };
    entry[row.field as Field] = name;
    byPhrase.set(row.phrase, entry);
  }
  return [...byPhrase.values()].slice(0, PROMPT_LIMIT);
}

/** O que o Jotta aprendeu, para a tela de Ajustes (só o que ainda existe). */
export async function listMemory(userId: string): Promise<AssistantMemoryItem[]> {
  const [rows, accounts, categories] = await Promise.all([
    prisma.assistantMemory.findMany({
      where: { userId },
      orderBy: [{ phrase: 'asc' }, { field: 'asc' }],
    }),
    prisma.account.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { userId }, select: { id: true, name: true } }),
  ]);
  return rows.flatMap((row) => {
    const value =
      row.field === 'account'
        ? accounts.find((a) => a.id === row.valueId)?.name
        : categories.find((c) => c.id === row.valueId)?.name;
    if (!value) return [];
    return [
      {
        id: row.id,
        label: row.label,
        field: row.field as Field,
        value,
        uses: row.uses,
        updatedAt: row.updatedAt.toISOString(),
      },
    ];
  });
}

export async function deleteMemory(userId: string, id: string) {
  const { count } = await prisma.assistantMemory.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound('Preferência');
}

export async function clearMemory(userId: string) {
  await prisma.assistantMemory.deleteMany({ where: { userId } });
}
