import type { AssistantCardResponse, AssistantMessageResponse } from '@jottape/schemas';
import { describe, expect, it } from 'vitest';

import { stepTag, toSteps } from './steps';

const message = (
  id: string,
  role: 'USER' | 'ASSISTANT',
  cards: AssistantCardResponse[] = []
): AssistantMessageResponse => ({
  id,
  role,
  text: id,
  values: [],
  cards,
  trace: null,
  reported: false,
  voiceSeconds: null,
  createdAt: '2026-10-21T12:00:00.000Z',
});

const card = (draft: AssistantCardResponse['draft']) =>
  ({ id: 'c', status: 'SAVED', draft }) as AssistantCardResponse;

describe('toSteps', () => {
  it('junta cada pedido com as respostas dele', () => {
    const steps = toSteps([
      message('a', 'USER'),
      message('b', 'ASSISTANT'),
      message('c', 'USER'),
      message('d', 'ASSISTANT'),
      message('e', 'ASSISTANT'),
    ]);
    expect(steps.map((s) => [s.request?.id, s.replies.map((r) => r.id)])).toEqual([
      ['a', ['b']],
      ['c', ['d', 'e']],
    ]);
  });

  it('aceita o histórico começando por uma resposta', () => {
    const [first] = toSteps([message('b', 'ASSISTANT'), message('c', 'USER')]);
    expect(first.request).toBeNull();
    expect(first.replies.map((r) => r.id)).toEqual(['b']);
  });
});

describe('stepTag', () => {
  const step = (cards: AssistantCardResponse[]) => ({
    request: message('a', 'USER'),
    replies: [message('b', 'ASSISTANT', cards)],
  });

  it('marca pelo primeiro cartão, e pergunta sem cartão é ASK', () => {
    expect(stepTag(step([]))).toBe('ASK');
    expect(stepTag(step([card({ type: 'event' } as AssistantCardResponse['draft'])]))).toBe('AGD');
    expect(stepTag(step([card({ type: 'task' } as AssistantCardResponse['draft'])]))).toBe('TAR');
    expect(stepTag(step([card({ type: 'transaction' } as AssistantCardResponse['draft'])]))).toBe(
      'FIN'
    );
    expect(
      stepTag(step([card({ type: 'change', target: 'task' } as AssistantCardResponse['draft'])]))
    ).toBe('TAR');
  });
});
