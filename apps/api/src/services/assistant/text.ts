import type { AssistantDraft, AssistantMissing } from '@jottape/schemas';

import { describeMissing, type Intent } from './resolve';

// Frases da resposta do Assistente. Sem valores: o app pode estar com os valores ocultos, e o
// cartão abaixo da frase já mostra o que foi criado.

export const EXAMPLE_HINT =
  'Não entendi o pedido. Tente algo como “gastei 32 reais no mercado”, “dentista amanhã às 15h” ou “me lembra de pagar o IPVA sexta”.';

export const COMING_SOON =
  'Perguntas sobre gastos e agenda chegam numa próxima versão. Por enquanto eu crio lançamentos, eventos e tarefas.';

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

export function replyText(cards: CardOutcome[], otherIntents: Intent[]): string {
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

  if (otherIntents.includes('question')) parts.push(COMING_SOON);
  if (parts.length === 0) return EXAMPLE_HINT;
  return parts.join(' ');
}
