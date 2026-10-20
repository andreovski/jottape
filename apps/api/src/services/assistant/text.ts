import type { AssistantMissing } from '@jottape/schemas';

import { describeMissing, type Intent } from './resolve';

// Frases da resposta do Assistente. Sem valores: o app pode estar com os valores ocultos, e o
// cartão abaixo da frase já mostra o lançamento.

export const EXAMPLE_HINT =
  'Não entendi o pedido. Tente algo como “gastei 32 reais no mercado hoje” ou “recebi o salário de 5 mil”.';

export const COMING_SOON =
  'Agenda, tarefas e perguntas sobre os gastos chegam nas próximas versões. Por enquanto eu cuido dos lançamentos.';

export const READ_FAILED = 'Não consegui ler o pedido agora. Tente de novo em instantes.';

export interface CardOutcome {
  saved: boolean;
  missing: AssistantMissing[];
}

export function replyText(cards: CardOutcome[], otherIntents: Intent[]): string {
  const parts: string[] = [];
  const saved = cards.filter((c) => c.saved);
  const drafts = cards.filter((c) => !c.saved);

  if (saved.length > 0) {
    parts.push(
      saved.length === 1 ? 'Pronto, salvei.' : `Pronto, salvei os ${saved.length} lançamentos.`
    );
  }
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
        : 'Confira os lançamentos antes de salvar.'
    );
  }

  const pending = otherIntents.filter((intent) => intent !== 'other');
  if (pending.length > 0) parts.push(COMING_SOON);
  if (parts.length === 0) return EXAMPLE_HINT;
  return parts.join(' ');
}
