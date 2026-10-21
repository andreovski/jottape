import type { AssistantCardResponse, AssistantMessageResponse } from '@jottape/schemas';

// Linha do tempo do Jotta: cada pedido com as respostas dele e a etiqueta do módulo.

export type Tag = 'FIN' | 'AGD' | 'TAR' | 'ASK';

export const TAG_COLOR: Record<Tag, string> = {
  FIN: 'var(--green)',
  AGD: 'var(--red)',
  TAR: 'var(--orange)',
  ASK: 'var(--cyan)',
};

function cardTag(card: AssistantCardResponse): Tag {
  const { draft } = card;
  const target = draft.type === 'change' ? draft.target : draft.type;
  return target === 'event' ? 'AGD' : target === 'task' ? 'TAR' : 'FIN';
}

export interface Step {
  /** O pedido. Null quando o histórico começa no meio (a resposta sem o pedido). */
  request: AssistantMessageResponse | null;
  replies: AssistantMessageResponse[];
}

/** Junta cada pedido com as respostas que vieram depois dele. */
export function toSteps(messages: AssistantMessageResponse[]): Step[] {
  const steps: Step[] = [];
  for (const message of messages) {
    if (message.role === 'USER') steps.push({ request: message, replies: [] });
    else if (steps.length === 0) steps.push({ request: null, replies: [message] });
    else steps[steps.length - 1].replies.push(message);
  }
  return steps;
}

export function stepTag(step: Step): Tag {
  const card = step.replies.flatMap((reply) => reply.cards)[0];
  return card ? cardTag(card) : 'ASK';
}
