import { categorizeBatch } from './ai-batch';
import type { AiCategory, AiMovement } from './ai-model';
import { shortDescription } from './movements';

// Teste de acerto da categoria na revisão do banco: lançamentos com cara dos de verdade, cada um
// com a categoria certa (ou nenhuma, quando não dá para saber), pelo Haiku e pelo Jev de verdade.
// Roda na CI (scripts/bank-benchmark-ci.ts) e à mão com `pnpm --filter api bench:bank run`.

/** As categorias padrão do cadastro e as fixas, com o id igual ao nome. */
const NAMES: [AiCategory['kind'], string][] = [
  ['INCOME', 'Salário'],
  ['INCOME', 'Outras receitas'],
  ['INCOME', 'Transferência'],
  ['INCOME', 'Transferência › Pix'],
  ['INCOME', 'Transferência › Débito'],
  ['INCOME', 'Transferência › Crédito'],
  ['EXPENSE', 'Moradia'],
  ['EXPENSE', 'Mercado'],
  ['EXPENSE', 'Alimentação'],
  ['EXPENSE', 'Transporte'],
  ['EXPENSE', 'Saúde'],
  ['EXPENSE', 'Lazer'],
  ['EXPENSE', 'Assinaturas'],
  ['EXPENSE', 'Educação'],
  ['EXPENSE', 'Outras despesas'],
  ['EXPENSE', 'Transferência'],
  ['EXPENSE', 'Transferência › Pix'],
  ['EXPENSE', 'Transferência › Débito'],
  ['EXPENSE', 'Transferência › Crédito'],
];
export const BENCH_CATEGORIES: AiCategory[] = NAMES.map(([kind, label]) => ({
  id: `${kind}:${label}`,
  kind,
  label,
}));

export interface BankBenchCase {
  kind: AiMovement['kind'];
  amountCents: number;
  /** O texto como vem do banco. */
  text: string;
  card?: boolean;
  /** A categoria certa, pelo nome; null quando o certo é deixar em branco. */
  expected: string | null;
}

const PIX_OUT = 'Transferência enviada pelo Pix';
const PIX_IN = 'Transferência recebida pelo Pix';
const out = (
  text: string,
  expected: string | null,
  amountCents = 5000,
  card = false
): BankBenchCase => ({ kind: 'EXPENSE', amountCents, text, card, expected });
const income = (text: string, expected: string | null, amountCents = 10000): BankBenchCase => ({
  kind: 'INCOME',
  amountCents,
  text,
  expected,
});

export const BANK_BENCH_CASES: BankBenchCase[] = [
  out('UBER *TRIP HELP.UBER.COM', 'Transporte', 2390, true),
  out('99APP *99RIDE', 'Transporte', 1875, true),
  out('POSTO SHELL IPIRANGA', 'Transporte', 21000, true),
  out('SEM PARAR', 'Transporte', 4590, true),
  out(
    `${PIX_OUT}|AUTO POSTO SAO JOAO LTDA|12.345.678/0001-90|BCO DO BRASIL S.A.`,
    'Transporte',
    15000
  ),
  out('IFOOD *IFOOD', 'Alimentação', 5890, true),
  out('RAPPI*RESTAURANTE', 'Alimentação', 7420, true),
  out('Compra no débito|PADARIA REAL', 'Alimentação', 1890),
  out(
    `${PIX_OUT}|RESTAURANTE SABOR CASEIRO LTDA|23.456.789/0001-01|ITAU UNIBANCO`,
    'Alimentação',
    6200
  ),
  out('PAO DE ACUCAR 1234', 'Mercado', 18765, true),
  out('Compra no débito|CARREFOUR HIPER', 'Mercado', 34210),
  out('ASSAI ATACADISTA', 'Mercado', 52300, true),
  out('NETFLIX.COM', 'Assinaturas', 5590, true),
  out('SPOTIFY', 'Assinaturas', 2190, true),
  out('AMAZON PRIME', 'Assinaturas', 1990, true),
  out('APPLE.COM/BILL', 'Assinaturas', 990, true),
  out('DROGASIL 0234', 'Saúde', 8730, true),
  out('DROGA RAIA', 'Saúde', 4560, true),
  out('UNIMED SEGUROS', 'Saúde', 65000),
  out('Pagamento de boleto|ENEL DISTRIBUICAO SP', 'Moradia', 23400),
  out('Pagamento de boleto|SABESP', 'Moradia', 9800),
  out('CINEMARK', 'Lazer', 6400, true),
  out('STEAMGAMES.COM', 'Lazer', 4999, true),
  out('UDEMY', 'Educação', 2790, true),
  out(
    `${PIX_OUT}|JOSIANE CRISTINA DA SILVA|•••.123.456-••|NU PAGAMENTOS - IP`,
    'Transferência › Pix'
  ),
  out(
    `${PIX_OUT}|MARCOS PEREIRA|•••.987.654-••|CAIXA ECONOMICA FEDERAL`,
    'Transferência › Pix',
    12000
  ),
  out('COMPRA LOJA 4321', null, 4200, true),
  out('PAG*JOSEMARIA', null, 3500, true),
  out('SumUp *SUMUP', null, 2000, true),
  income(`${PIX_IN}|MARIA DE SOUZA|•••.111.222-••|BCO BRADESCO`, 'Transferência › Pix', 15000),
  income(`${PIX_IN}|JOAO PAULO SANTOS|•••.333.444-••|NU PAGAMENTOS - IP`, 'Transferência › Pix'),
  income('SALARIO EMPRESA XYZ LTDA', 'Salário', 850000),
  income('Pagamento recebido|FOLHA DE PAGAMENTO ACME', 'Salário', 720000),
  income('RENDIMENTO DA CONTA', 'Outras receitas', 123),
];

export const caseKey = (c: Pick<BankBenchCase, 'kind' | 'text'>) => `${c.kind}:${c.text}`;

export interface BankBenchResult {
  key: string;
  text: string;
  expected: string | null;
  /** O que a IA sugeriu (null: deixou em branco). */
  got: string | null;
  passed: boolean;
  /** Sugeriu uma categoria errada (pior que deixar em branco). */
  wrong: boolean;
}

export interface BankBenchRun {
  cases: BankBenchResult[];
  usage: { modelInput: number; modelOutput: number; jevInput: number; costMicros: number };
  ms: number;
}

/** Roda os casos pela IA de verdade, num lote (o Haiku olha até 40 de uma vez). */
export async function runBankBenchmark(cases: BankBenchCase[]): Promise<BankBenchRun> {
  const start = Date.now();
  const results: BankBenchResult[] = [];
  const usage = { modelInput: 0, modelOutput: 0, jevInput: 0, costMicros: 0 };
  for (let i = 0; i < cases.length; i += 40) {
    const batch = cases.slice(i, i + 40);
    const input: AiMovement[] = batch.map((c) => ({
      kind: c.kind,
      amountCents: c.amountCents,
      title: shortDescription(c.text),
      bankText: c.text,
      card: Boolean(c.card),
    }));
    const { items, usage: used } = await categorizeBatch(input, BENCH_CATEGORIES);
    usage.modelInput += used.modelInput;
    usage.modelOutput += used.modelOutput;
    usage.jevInput += used.jevInput;
    usage.costMicros += used.costMicros;
    batch.forEach((c, j) => {
      const decision = items[j]!.decision;
      const got = decision
        ? (BENCH_CATEGORIES.find((x) => x.id === decision.categoryId)?.label ?? null)
        : null;
      results.push({
        key: caseKey(c),
        text: c.text,
        expected: c.expected,
        got,
        passed: got === c.expected,
        wrong: got !== null && got !== c.expected,
      });
    });
  }
  return { cases: results, usage, ms: Date.now() - start };
}
