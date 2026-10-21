import { describe, expect, it } from 'vitest';

import type { PluggyTransaction } from './client';
import {
  categoryMemory,
  findMatch,
  importedDescription,
  type MatchCandidate,
  normalize,
  parseMovement,
  suggestCategory,
} from './movements';

const TZ = 'America/Sao_Paulo';

const tx = (fields: Partial<PluggyTransaction>): PluggyTransaction => ({
  id: 'tx-1',
  description: 'Padaria Pão Quente',
  amount: -12.5,
  date: '2026-10-10T03:00:00.000Z',
  type: 'DEBIT',
  status: 'POSTED',
  ...fields,
});

const candidate = (fields: Partial<MatchCandidate>): MatchCandidate => ({
  id: 'c-1',
  kind: 'EXPENSE',
  amountCents: 1250,
  date: '2026-10-10',
  accountId: 'acc',
  toAccountId: null,
  installmentNumber: null,
  installmentTotal: null,
  ...fields,
});

describe('parseMovement', () => {
  it('débito vira despesa em centavos positivos, no dia do fuso do usuário', () => {
    expect(parseMovement(tx({}), 'BANK', TZ)).toMatchObject({
      kind: 'EXPENSE',
      amountCents: 1250,
      date: '2026-10-10',
      isCardPayment: false,
    });
  });

  it('crédito vira receita', () => {
    expect(parseMovement(tx({ amount: 3000, type: 'CREDIT' }), 'BANK', TZ)?.kind).toBe('INCOME');
  });

  it('na conta, o agendado (PENDING) fica de fora; no cartão, a compra pendente entra', () => {
    expect(parseMovement(tx({ status: 'PENDING' }), 'BANK', TZ)).toBeNull();
    expect(parseMovement(tx({ status: 'PENDING', amount: 12.5 }), 'CREDIT', TZ)).not.toBeNull();
  });

  it('usa o valor na moeda da conta quando a compra foi em outra moeda', () => {
    expect(
      parseMovement(tx({ amount: 10, amountInAccountCurrency: 55.3 }), 'CREDIT', TZ)?.amountCents
    ).toBe(5530);
  });

  it('pagamento recebido no cartão é marcado como pagamento da fatura', () => {
    const payment = tx({ description: 'Pagamento recebido', amount: -800, type: 'CREDIT' });
    expect(parseMovement(payment, 'CREDIT', TZ)?.isCardPayment).toBe(true);
    const refund = tx({ description: 'Estorno Loja', amount: -20, type: 'CREDIT' });
    expect(parseMovement(refund, 'CREDIT', TZ)?.isCardPayment).toBe(false);
  });

  it('parcela datada pela compra vai para o mês dela', () => {
    const third = tx({
      amount: 100,
      date: '2026-08-05T03:00:00.000Z',
      creditCardMetadata: {
        installmentNumber: 3,
        totalInstallments: 10,
        purchaseDate: '2026-08-05T03:00:00.000Z',
      },
    });
    expect(parseMovement(third, 'CREDIT', TZ)).toMatchObject({
      date: '2026-10-05',
      installmentNumber: 3,
      installmentTotal: 10,
    });
  });

  it('parcela já datada no mês certo fica como veio', () => {
    const third = tx({
      amount: 100,
      date: '2026-10-07T03:00:00.000Z',
      creditCardMetadata: { installmentNumber: 3, totalInstallments: 10 },
    });
    expect(parseMovement(third, 'CREDIT', TZ)?.date).toBe('2026-10-07');
  });
});

describe('findMatch', () => {
  const movement = parseMovement(tx({}), 'BANK', TZ)!;

  it('casa mesmo valor e sentido com data perto, o mais próximo primeiro', () => {
    const far = candidate({ id: 'far', date: '2026-10-13' });
    const near = candidate({ id: 'near', date: '2026-10-11' });
    expect(findMatch(movement, 'acc', [far, near], new Set())?.id).toBe('near');
  });

  it('não casa valor diferente, data longe, outra conta, sentido oposto ou já usado', () => {
    const none = [
      candidate({ amountCents: 1251 }),
      candidate({ date: '2026-10-20' }),
      candidate({ accountId: 'other' }),
      candidate({ kind: 'INCOME' }),
    ];
    expect(findMatch(movement, 'acc', none, new Set())).toBeNull();
    expect(findMatch(movement, 'acc', [candidate({})], new Set(['c-1']))).toBeNull();
  });

  it('transferência casa pelos dois lados: saída na origem, entrada no destino', () => {
    const transfer = candidate({ kind: 'TRANSFER', accountId: 'acc', toAccountId: 'card' });
    expect(findMatch(movement, 'acc', [transfer], new Set())?.id).toBe('c-1');
    const incoming = parseMovement(tx({ type: 'CREDIT', amount: 12.5 }), 'CREDIT', TZ)!;
    expect(findMatch(incoming, 'card', [transfer], new Set())?.id).toBe('c-1');
  });

  it('parcela casa pelo número da parcela, com folga de centavos e de data', () => {
    const installment = parseMovement(
      tx({
        amount: 33.33,
        date: '2026-10-25T03:00:00.000Z',
        creditCardMetadata: { installmentNumber: 2, totalInstallments: 3 },
      }),
      'CREDIT',
      TZ
    )!;
    const jottape = [
      candidate({
        id: 'p1',
        amountCents: 3334,
        installmentNumber: 1,
        installmentTotal: 3,
        date: '2026-09-15',
      }),
      candidate({
        id: 'p2',
        amountCents: 3333,
        installmentNumber: 2,
        installmentTotal: 3,
        date: '2026-10-15',
      }),
    ];
    expect(findMatch(installment, 'acc', jottape, new Set())?.id).toBe('p2');
  });
});

describe('categorias', () => {
  it('normaliza sem acento, números e pontuação, nas três primeiras palavras', () => {
    expect(normalize('PADARIA Pão-Quente 123 Centro SP')).toBe('padaria pao quente');
  });

  it('sugere a categoria do lançamento mais recente com a mesma descrição e tipo', () => {
    const memory = categoryMemory([
      { description: 'Padaria Pão Quente', kind: 'EXPENSE', categoryId: 'nova' },
      { description: 'padaria pao quente', kind: 'EXPENSE', categoryId: 'velha' },
      { description: 'Padaria Pão Quente', kind: 'INCOME', categoryId: 'receita' },
    ]);
    expect(
      suggestCategory(memory, { kind: 'EXPENSE', description: 'PADARIA PÃO QUENTE 0001' })
    ).toBe('nova');
    expect(suggestCategory(memory, { kind: 'EXPENSE', description: 'Mercado' })).toBeNull();
  });
});

it('a parcela vai no fim da descrição', () => {
  expect(
    importedDescription({ description: 'Loja', installmentNumber: 2, installmentTotal: 10 })
  ).toBe('Loja (2/10)');
  expect(
    importedDescription({ description: 'Loja', installmentNumber: null, installmentTotal: null })
  ).toBe('Loja');
});
