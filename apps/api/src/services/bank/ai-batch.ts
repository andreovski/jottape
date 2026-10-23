import type { BankAiTrace } from '@jottape/schemas';

import { HAIKU_INPUT, HAIKU_OUTPUT, JEV_INPUT } from '@/services/assistant';

import { type AiCategory, type AiMovement, classifyWithHaiku, scoreWithJev } from './ai-model';
import { decideAiCategory } from './movements';

// Um lote pela IA: o Haiku olha todos de uma vez e o Jev confere cada um; a decisão é a de
// `decideAiCategory`. Sem banco de dados: serve à sincronização (ai.ts) e ao teste de acerto.

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

export interface BatchItem {
  decision: { categoryId: string; confidence: number } | null;
  /** O que cada IA fez com este lançamento e quanto custou (o modo dev mostra). */
  trace: BankAiTrace;
}

export interface BatchResult {
  items: BatchItem[];
  usage: { modelInput: number; modelOutput: number; jevInput: number; costMicros: number };
}

const micros = (value: number) => Math.round(value);

/** Lança erro se o Haiku falhar; o Jev que falha vale como "sem resposta" (não decide). */
export async function categorizeBatch(
  input: AiMovement[],
  categories: AiCategory[]
): Promise<BatchResult> {
  const label = new Map(categories.map((c) => [c.id, c.label]));
  const haikuStart = Date.now();
  const [haiku, jev] = await Promise.all([
    classifyWithHaiku(input, categories).then((result) => ({
      ...result,
      ms: Date.now() - haikuStart,
    })),
    inParallel(input, JEV_CONCURRENCY, async (m) => {
      const start = Date.now();
      try {
        const result = await scoreWithJev(m, categories);
        return result && { ...result, ms: Date.now() - start };
      } catch (error) {
        console.error('[bank:ai] jev', error);
        return null;
      }
    }),
  ]);

  const haikuCost = haiku.inputTokens * HAIKU_INPUT + haiku.outputTokens * HAIKU_OUTPUT;
  const items = input.map((_, i): BatchItem => {
    const pick = haiku.picks[i] ?? null;
    const scored = jev[i] ?? null;
    const decision = decideAiCategory(pick, scored?.probabilities ?? null);
    let top: { id: string; probability: number } | null = null;
    for (const [id, probability] of scored?.probabilities ?? []) {
      if (!top || probability > top.probability) top = { id, probability };
    }
    // O Haiku olha o lote inteiro: cada lançamento fica com a sua parte.
    const haikuShare = micros(haikuCost / input.length);
    const jevCost = micros((scored?.inputTokens ?? 0) * JEV_INPUT);
    return {
      decision,
      trace: {
        haiku: {
          pick: pick ? (label.get(pick) ?? null) : null,
          batchSize: input.length,
          inputTokens: haiku.inputTokens,
          outputTokens: haiku.outputTokens,
          costMicros: haikuShare,
          ms: haiku.ms,
        },
        jev: scored
          ? {
              top: top ? (label.get(top.id) ?? null) : null,
              probability: top?.probability ?? null,
              inputTokens: scored.inputTokens,
              costMicros: jevCost,
              ms: scored.ms,
            }
          : null,
        decided: Boolean(decision),
        costMicros: haikuShare + jevCost,
      },
    };
  });
  const jevInput = jev.reduce((sum, r) => sum + (r?.inputTokens ?? 0), 0);
  return {
    items,
    usage: {
      modelInput: haiku.inputTokens,
      modelOutput: haiku.outputTokens,
      jevInput,
      costMicros: micros(haikuCost + jevInput * JEV_INPUT),
    },
  };
}
