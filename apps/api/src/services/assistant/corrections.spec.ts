import type { AssistantDraft } from '@jottape/schemas';
import { describe, expect, it } from 'vitest';

import { correctionsOf } from './corrections';

const TZ = 'America/Sao_Paulo';

const expense: AssistantDraft = {
  type: 'transaction',
  kind: 'EXPENSE',
  amountCents: 4500,
  date: '2026-10-14',
  accountId: 'nubank',
  toAccountId: null,
  categoryId: 'alimentacao',
  description: 'iFood',
  installments: null,
};

describe('correctionsOf', () => {
  it('conta a conta e a categoria trocadas na folha', () => {
    expect(
      correctionsOf(
        expense,
        {
          transaction: {
            kind: 'EXPENSE',
            amountCents: 4500,
            date: '2026-10-14',
            accountId: 'cartao',
            categoryId: 'lazer',
            description: 'iFood ',
          },
        },
        TZ,
        null
      )
    ).toEqual(['account', 'category']);
  });

  it('completar o que faltava não é correção', () => {
    const missing = { ...expense, amountCents: null, accountId: null };
    expect(
      correctionsOf(missing, { draft: { amountCents: 3000, accountId: 'nubank' } }, TZ, null)
    ).toEqual([]);
  });

  it('a conta escolhida no botão do cartão conta', () => {
    expect(correctionsOf(expense, { draft: { accountId: 'itau' } }, TZ, null)).toEqual(['account']);
  });

  it('evento: compara dia e horário no fuso, e as notas', () => {
    const event: AssistantDraft = {
      type: 'event',
      title: 'Entrega de trabalho',
      date: '2026-10-22',
      startTime: '14:00',
      endTime: '15:00',
      allDay: false,
      location: null,
      notes: null,
    };
    expect(
      correctionsOf(
        event,
        {
          event: {
            title: 'Entrega de trabalho',
            startAt: '2026-10-22T17:00:00.000Z',
            endAt: '2026-10-22T18:30:00.000Z',
            allDay: false,
            description: 'Pela plataforma da faculdade',
          },
        },
        TZ,
        null
      )
    ).toEqual(['notes', 'end']);
    expect(
      correctionsOf(
        { ...event, notes: 'Levar o pendrive' },
        {
          event: {
            title: 'Entrega',
            startAt: '2026-10-22T18:00:00.000Z',
            endAt: '2026-10-22T18:00:00.000Z',
            allDay: false,
            description: '',
          },
        },
        TZ,
        null
      )
    ).toEqual(['title', 'notes', 'time']);
  });

  it('tarefa: sem lista no rascunho é a Entrada', () => {
    const task: AssistantDraft = {
      type: 'task',
      title: 'Comprar pão',
      date: null,
      time: null,
      listId: null,
      notes: null,
    };
    expect(
      correctionsOf(task, { task: { title: 'Comprar pão', listId: 'inbox' } }, TZ, 'inbox')
    ).toEqual([]);
    expect(
      correctionsOf(task, { task: { title: 'Comprar pão', listId: 'mercado' } }, TZ, 'inbox')
    ).toEqual(['list']);
  });
});
