import { describe, expect, it } from 'vitest';

import { type LedgerRow, matchNames, summarizeLedger } from './summary';

const row = (overrides: Partial<LedgerRow>): LedgerRow => ({
  id: 't1',
  date: '2026-10-19',
  createdAt: '2026-10-19T12:00:00.000Z',
  description: 'iFood',
  amountCents: 4000,
  kind: 'EXPENSE',
  status: 'DONE',
  category: 'Alimentação',
  account: 'Nubank',
  ...overrides,
});

describe('matchNames', () => {
  it('casa sem acento e por "contém", e diz o que não achou', () => {
    const options = [{ name: 'Alimentação' }, { name: 'Restaurantes' }, { name: 'Transporte' }];
    expect(matchNames(options, ['alimentacao', 'restaurante', 'pets'])).toEqual({
      found: [{ name: 'Alimentação' }, { name: 'Restaurantes' }],
      missing: ['pets'],
    });
  });
});

describe('summarizeLedger', () => {
  it('soma realizado e previsto à parte e agrupa despesas por categoria', () => {
    const summary = summarizeLedger([
      row({}),
      row({ description: 'Padaria', amountCents: 1500 }),
      row({ description: 'Uber', amountCents: 2500, category: 'Transporte' }),
      row({ description: 'Mercado', amountCents: 9000, status: 'PLANNED' }),
      row({ description: 'Salário', amountCents: 500000, kind: 'INCOME', category: null }),
    ]);
    expect(summary).toMatchObject({
      quantidade: 5,
      despesas_realizadas_centavos: 8000,
      despesas_previstas_centavos: 9000,
      receitas_realizadas_centavos: 500000,
      despesas_por_categoria: [
        { categoria: 'Alimentação', total_centavos: 5500 },
        { categoria: 'Transporte', total_centavos: 2500 },
      ],
      itens_omitidos: 0,
    });
    expect(summary.itens[0]).toMatchObject({ descricao: 'Salário', tipo: 'receita' });
    expect(summary.itens[1]).toMatchObject({ descricao: 'Mercado', situacao: 'previsto' });
  });
});
