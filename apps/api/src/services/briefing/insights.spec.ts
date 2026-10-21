import { describe, expect, it } from 'vitest';

import { insightLines, insightTarget, toStored } from './insights';

describe('insights de IA', () => {
  it('analisa o mês corrente, e o fechamento do anterior do dia 1 ao 3', () => {
    expect(insightTarget('2026-10-20')).toEqual({ kind: 'month', month: '2026-10' });
    expect(insightTarget('2026-10-04')).toEqual({ kind: 'month', month: '2026-10' });
    expect(insightTarget('2026-11-03')).toEqual({ kind: 'close', month: '2026-10' });
    expect(insightTarget('2027-01-01')).toEqual({ kind: 'close', month: '2026-12' });
  });

  it('troca o dinheiro por marcadores e leva a pergunta para o Assistente', () => {
    const stored = toStored([
      {
        texto: ' Mercado subiu para R$ [[30000]] contra [[20000]]. ',
        tom: 'atencao',
        pergunta: 'Com o que gastei mais em Mercado?',
      },
      { texto: '   ', tom: 'neutro', pergunta: '' },
    ]);
    expect(stored).toEqual([
      {
        text: 'Mercado subiu para {0} contra {1}.',
        values: [30000, 20000],
        tone: 'warning',
        question: 'Com o que gastei mais em Mercado?',
      },
    ]);
    expect(insightLines(stored)[0]).toMatchObject({
      text: 'Mercado subiu para {0} contra {1}.',
      tone: 'warning',
      href: '/assistente?pergunta=Com%20o%20que%20gastei%20mais%20em%20Mercado%3F',
    });
  });
});
