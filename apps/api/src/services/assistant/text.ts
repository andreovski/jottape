import type { AssistantDraft, AssistantMissing } from '@jottape/schemas';

import { describeMissing, type Intent } from './resolve';

// Frases da resposta do Assistente. As frases dos cartões não têm valores (o cartão já mostra o
// que foi criado); a resposta de uma pergunta tem, como `{n}` + `values`, porque o app pode estar
// com os valores ocultos.

export const EXAMPLE_HINT =
  'Não entendi o pedido. Tente algo como “gastei 32 reais no mercado”, “dentista amanhã às 15h” ou “me lembra de pagar o IPVA sexta”.';

export const ANSWER_FAILED = 'Não consegui responder à pergunta agora. Tente de novo em instantes.';

export const READ_FAILED = 'Não consegui ler o pedido agora. Tente de novo em instantes.';

export interface CardOutcome {
  type: AssistantDraft['type'];
  saved: boolean;
  missing: AssistantMissing[];
}

const SAVED_ONE: Record<AssistantDraft['type'], string> = {
  transaction: 'Pronto, salvei.',
  event: 'Pronto, está na agenda.',
  task: 'Pronto, anotei nas tarefas.',
};

/**
 * A resposta de uma pergunta escreve dinheiro como [[centavos]]. Vira `{0}`, `{1}`... com os
 * valores à parte, como no briefing, para o app poder ocultar.
 */
export function extractMoney(text: string): { text: string; values: number[] } {
  const values: number[] = [];
  const replaced = text
    // Chave que o modelo escreveu não pode virar marcador.
    .replace(/[{}]/g, (brace) => (brace === '{' ? '(' : ')'))
    .replace(/(?:R\$\s*)?\[\[\s*(-?\d+)\s*\]\]/g, (_, cents: string) => {
      values.push(Number(cents));
      return `{${values.length - 1}}`;
    });
  return { text: replaced, values };
}

/** O contrário: o texto como o modelo escreveu, para o histórico que volta para ele. */
export function restoreMoney(text: string, values: number[]): string {
  return text.replace(/\{(\d+)\}/g, (_, i: string) => {
    const cents = values[Number(i)];
    return cents === undefined ? '' : `[[${cents}]]`;
  });
}

export function replyText(
  cards: CardOutcome[],
  otherIntents: Intent[],
  /** Resposta das perguntas (já com `{n}`), ou null se falhou. */
  answer: string | null = null
): string {
  const parts: string[] = [];
  const saved = cards.filter((c) => c.saved);
  const drafts = cards.filter((c) => !c.saved);

  if (saved.length === 1) parts.push(SAVED_ONE[saved[0].type]);
  else if (saved.length > 1) parts.push(`Pronto, salvei os ${saved.length}.`);

  if (drafts.length === 1) {
    const missing = drafts[0].missing;
    parts.push(
      missing.length > 0
        ? `Falta ${describeMissing(missing)} para salvar.`
        : saved.length > 0
          ? 'O outro ficou para você conferir.'
          : 'Confira e salve.'
    );
  } else if (drafts.length > 1) {
    parts.push(
      saved.length > 0
        ? `Os outros ${drafts.length} ficaram para você conferir.`
        : 'Confira antes de salvar.'
    );
  }

  if (otherIntents.includes('question')) parts.push(answer || ANSWER_FAILED);
  if (parts.length === 0) return EXAMPLE_HINT;
  return parts.join(' ');
}
