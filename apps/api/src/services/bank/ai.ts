import type { Prisma } from '@prisma/client';

import { getAnthropicConfig, getJevConfig } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { assistantEnabled } from '@/services/assistant';

import { categorizeBatch } from './ai-batch';
import type { AiCategory, AiMovement } from './ai-model';
import { looksLikeInvoicePayment, shortDescription } from './movements';

// A IA na revisão do banco: depois da sincronização, os que esperam revisão sem sugestão do
// histórico passam pelo Haiku e pelo Jev, uma vez só cada (`aiCheckedAt`). É do Jotta (a parte
// paga): só para quem tem o Assistente. O custo entra como BANK_CATEGORY, fora do limite do mês.

/** Lançamentos por chamada do Haiku. */
const BATCH = 40;
/** Teto de segurança: quantos lançamentos a IA olha por pessoa em 24 h. */
export const AI_DAILY_LIMIT = 200;

/** Categorias como a pessoa vê: a subcategoria leva o nome da mãe ("Transferência › Pix"). */
async function categoriesOf(userId: string): Promise<AiCategory[]> {
  const categories = await prisma.category.findMany({
    where: { userId },
    select: { id: true, name: true, kind: true, parentId: true },
    orderBy: { name: 'asc' },
  });
  const names = new Map(categories.map((c) => [c.id, c.name]));
  return categories.map((c) => ({
    id: c.id,
    kind: c.kind,
    label: c.parentId && names.has(c.parentId) ? `${names.get(c.parentId)} › ${c.name}` : c.name,
  }));
}

/**
 * Sugere pela IA a categoria dos que esperam revisão sem sugestão do histórico. Devolve quantos
 * ganharam sugestão. Falha da IA não sobe: os lançamentos ficam para a próxima sincronização.
 */
export async function suggestWithAi(userId: string): Promise<number> {
  if (!getAnthropicConfig() || !getJevConfig()) return 0;
  if (!(await assistantEnabled(userId))) return 0;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const checkedToday = await prisma.bankMovement.count({
    where: { userId, aiCheckedAt: { gte: since } },
  });
  const room = AI_DAILY_LIMIT - checkedToday;
  if (room <= 0) return 0;

  const found = await prisma.bankMovement.findMany({
    where: {
      userId,
      status: 'PENDING',
      aiCheckedAt: null,
      OR: [{ suggestionSource: null }, { suggestionSource: { not: 'HISTORY' } }],
      bankAccount: { accountId: { not: null } },
    },
    include: { bankAccount: { select: { type: true } } },
    orderBy: { date: 'desc' },
    take: room,
  });
  // Pagamento de fatura vira transferência para o cartão ao aceitar: não leva categoria.
  const movements = found.filter(
    (m) => !(m.kind === 'EXPENSE' && looksLikeInvoicePayment(m.description))
  );
  if (!movements.length) return 0;
  const categories = await categoriesOf(userId);
  if (!categories.length) return 0;

  let suggested = 0;
  for (let start = 0; start < movements.length; start += BATCH) {
    const batch = movements.slice(start, start + BATCH);
    const input: AiMovement[] = batch.map((m) => ({
      kind: m.kind === 'INCOME' ? 'INCOME' : 'EXPENSE',
      amountCents: m.amountCents,
      title: shortDescription(m.description),
      bankText: m.description,
      card: m.bankAccount.type === 'CREDIT',
    }));
    try {
      const { items, usage } = await categorizeBatch(input, categories);
      const now = new Date();
      const updates = batch.map((movement, i) => {
        const { decision, trace } = items[i]!;
        if (decision) suggested++;
        const checked = { aiCheckedAt: now, aiTrace: trace as unknown as Prisma.InputJsonValue };
        return prisma.bankMovement.updateMany({
          // Pode ter sido lançado ou ganhado sugestão do histórico enquanto a IA pensava.
          where: {
            id: movement.id,
            status: 'PENDING',
            OR: [{ suggestionSource: null }, { suggestionSource: { not: 'HISTORY' } }],
          },
          data: decision
            ? {
                ...checked,
                suggestedCategoryId: decision.categoryId,
                suggestionSource: 'AI',
                suggestionConfidence: decision.confidence,
              }
            : checked,
        });
      });
      await prisma.$transaction([
        ...updates,
        prisma.assistantUsage.create({
          data: {
            userId,
            kind: 'BANK_CATEGORY',
            jevInputTokens: usage.jevInput,
            modelInputTokens: usage.modelInput,
            modelOutputTokens: usage.modelOutput,
            costMicros: usage.costMicros,
          },
        }),
      ]);
    } catch (error) {
      console.error('[bank:ai]', userId, error);
      break;
    }
  }
  return suggested;
}
