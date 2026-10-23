import { getAnthropicConfig, getJevConfig } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { assistantEnabled, HAIKU_INPUT, HAIKU_OUTPUT, JEV_INPUT } from '@/services/assistant';

import { type AiCategory, type AiMovement, classifyWithHaiku, scoreWithJev } from './ai-model';
import { decideAiCategory, looksLikeInvoicePayment, shortDescription } from './movements';

// A IA na revisão do banco: depois da sincronização, os que esperam revisão sem sugestão do
// histórico passam pelo Haiku e pelo Jev, uma vez só cada (`aiCheckedAt`). É do Jotta (a parte
// paga): só para quem tem o Assistente. O custo entra como BANK_CATEGORY, fora do limite do mês.

/** Lançamentos por chamada do Haiku. */
const BATCH = 40;
/** Teto de segurança: quantos lançamentos a IA olha por pessoa em 24 h. */
export const AI_DAILY_LIMIT = 200;
/** Perguntas ao Jev ao mesmo tempo. */
const JEV_CONCURRENCY = 4;

async function inParallel<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]!);
      }
    })
  );
  return results;
}

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
      const [haiku, jev] = await Promise.all([
        classifyWithHaiku(input, categories),
        inParallel(input, JEV_CONCURRENCY, (m) =>
          scoreWithJev(m, categories).catch((error) => {
            console.error('[bank:ai] jev', error);
            return null;
          })
        ),
      ]);
      const now = new Date();
      const updates = batch.map((movement, i) => {
        const decision = decideAiCategory(haiku.picks[i] ?? null, jev[i]?.probabilities ?? null);
        if (decision) suggested++;
        return prisma.bankMovement.updateMany({
          // Pode ter sido lançado ou ganhado sugestão do histórico enquanto a IA pensava.
          where: {
            id: movement.id,
            status: 'PENDING',
            OR: [{ suggestionSource: null }, { suggestionSource: { not: 'HISTORY' } }],
          },
          data: decision
            ? {
                aiCheckedAt: now,
                suggestedCategoryId: decision.categoryId,
                suggestionSource: 'AI',
                suggestionConfidence: decision.confidence,
              }
            : { aiCheckedAt: now },
        });
      });
      const jevTokens = jev.reduce((sum, r) => sum + (r?.inputTokens ?? 0), 0);
      await prisma.$transaction([
        ...updates,
        prisma.assistantUsage.create({
          data: {
            userId,
            kind: 'BANK_CATEGORY',
            jevInputTokens: jevTokens,
            modelInputTokens: haiku.inputTokens,
            modelOutputTokens: haiku.outputTokens,
            costMicros: Math.round(
              haiku.inputTokens * HAIKU_INPUT +
                haiku.outputTokens * HAIKU_OUTPUT +
                jevTokens * JEV_INPUT
            ),
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
