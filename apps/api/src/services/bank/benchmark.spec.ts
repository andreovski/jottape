import { describe, expect, it, vi } from 'vitest';

import { classifyWithHaiku, scoreWithJev } from './ai-model';
import { BANK_BENCH_CASES, BENCH_CATEGORIES, runBankBenchmark } from './benchmark';

vi.mock('./ai-model', () => ({ classifyWithHaiku: vi.fn(), scoreWithJev: vi.fn() }));

const id = (kind: string, label: string) =>
  BENCH_CATEGORIES.find((c) => c.kind === kind && c.label === label)!.id;

describe('teste de acerto da categoria do banco', () => {
  it('os casos esperam categorias que existem', () => {
    for (const c of BANK_BENCH_CASES) {
      if (c.expected)
        expect(BENCH_CATEGORIES.some((x) => x.kind === c.kind && x.label === c.expected)).toBe(
          true
        );
    }
  });

  it('conta acerto, erro e em branco, com o custo de cada IA', async () => {
    const cases = [
      {
        kind: 'EXPENSE' as const,
        amountCents: 2390,
        text: 'UBER *TRIP',
        card: true,
        expected: 'Transporte',
      },
      {
        kind: 'EXPENSE' as const,
        amountCents: 5890,
        text: 'IFOOD',
        card: true,
        expected: 'Alimentação',
      },
      {
        kind: 'EXPENSE' as const,
        amountCents: 4200,
        text: 'COMPRA LOJA 4321',
        card: true,
        expected: null,
      },
    ];
    const transport = id('EXPENSE', 'Transporte');
    const leisure = id('EXPENSE', 'Lazer');
    vi.mocked(classifyWithHaiku).mockResolvedValue({
      picks: [transport, leisure, null],
      inputTokens: 3000,
      outputTokens: 300,
    });
    vi.mocked(scoreWithJev).mockImplementation(async (m) => ({
      probabilities: new Map([[m.title === 'IFOOD' ? leisure : transport, 0.9]]),
      inputTokens: 200,
    }));
    const run = await runBankBenchmark(cases);
    expect(run.cases.map((c) => [c.got, c.passed, c.wrong])).toEqual([
      ['Transporte', true, false],
      ['Lazer', false, true],
      [null, true, false],
    ]);
    // Haiku: 3000 × 0,1 + 300 × 0,5 = 450; Jev: 600 × 0,042 ≈ 25.
    expect(run.usage).toEqual({
      modelInput: 3000,
      modelOutput: 300,
      jevInput: 600,
      costMicros: 475,
    });
  });
});
