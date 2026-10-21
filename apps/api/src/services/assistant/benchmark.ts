import {
  type AssistantBenchmarkCase,
  type AssistantBenchmarkResponse,
  type AssistantTestCase,
  type AssistantTestContext,
  assistantTestContextSchema,
  type AssistantTestExpect,
  assistantTestExpectSchema,
} from '@jottape/schemas';
import type { Prisma, AssistantTestCase as TestCaseRow } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { extractItems } from './haiku';
import { askJev } from './jev';
import {
  type AccountOption,
  type CategoryOption,
  type Intent,
  isActionIntent,
  resolveAction,
  type TaskListOption,
} from './resolve';

// Teste de acerto do Assistente: 50 pedidos com a resposta certa, rodados pelo Haiku e pelo Jev de
// verdade (o dono roda no painel do beta). Usa contas, categorias e listas de mentira, num dia
// fixo, e não grava nada além do custo. Junto vão os casos reais (relatos que viraram caso), cada
// um com o dia e os nomes da pessoa naquele momento.

/** Quarta-feira: "ontem" é 13, "amanhã" 15, "sexta" 16, "segunda" 19. */
const TODAY = '2026-10-14';
const TIMEZONE = 'America/Sao_Paulo';

const ACCOUNTS: AccountOption[] = [
  { id: 'a-carteira', name: 'Carteira', type: 'WALLET' },
  { id: 'a-nubank', name: 'Nubank', type: 'CHECKING' },
  { id: 'a-itau', name: 'Itaú', type: 'CHECKING' },
  { id: 'a-poupanca', name: 'Poupança', type: 'SAVINGS' },
  { id: 'a-cartao', name: 'Cartão Nubank', type: 'CREDIT_CARD' },
];

// As categorias padrão do app (owner.ts), em ordem de nome como o serviço manda.
const CATEGORIES: CategoryOption[] = [
  ['Alimentação', 'EXPENSE'],
  ['Assinaturas', 'EXPENSE'],
  ['Educação', 'EXPENSE'],
  ['Lazer', 'EXPENSE'],
  ['Mercado', 'EXPENSE'],
  ['Moradia', 'EXPENSE'],
  ['Outras despesas', 'EXPENSE'],
  ['Outras receitas', 'INCOME'],
  ['Salário', 'INCOME'],
  ['Saúde', 'EXPENSE'],
  ['Transporte', 'EXPENSE'],
].map(([name, kind]) => ({ id: `c-${name}`, name, kind: kind as 'INCOME' | 'EXPENSE' }));

const LISTS: TaskListOption[] = [
  { id: 'l-entrada', name: 'Entrada' },
  { id: 'l-mercado', name: 'Mercado' },
  { id: 'l-trabalho', name: 'Trabalho' },
];

/** O que o primeiro item precisa ter. Campo fora daqui não é conferido. */
type Expect = AssistantTestExpect & { intents: Intent[] };

interface Options {
  today: string;
  timezone: string;
  accounts: AccountOption[];
  categories: CategoryOption[];
  lists: TaskListOption[];
}

const FIXED: Options = {
  today: TODAY,
  timezone: TIMEZONE,
  accounts: ACCOUNTS,
  categories: CATEGORIES,
  lists: LISTS,
};

/** Os nomes do caso real viram opções com ids de mentira, na ordem em que estavam. */
export function optionsFromContext(
  today: string,
  timezone: string,
  context: AssistantTestContext
): Options {
  return {
    today,
    timezone,
    accounts: context.accounts.map((a, i) => ({ id: `a-${i}`, ...a })),
    categories: context.categories.map((c, i) => ({ id: `c-${i}`, ...c })),
    lists: context.lists.map((l, i) => ({ id: `l-${i}`, ...l })),
  };
}

export const BENCHMARK_CASES: { text: string; expect: Expect }[] = [
  // Despesas
  {
    text: 'gastei 32 reais no mercado',
    expect: { intents: ['expense'], amountCents: 3200, date: TODAY, category: 'Mercado' },
  },
  {
    text: 'uber 18,50 ontem',
    expect: { intents: ['expense'], amountCents: 1850, date: '2026-10-13', category: 'Transporte' },
  },
  {
    text: 'paguei 45 no ifood no nubank',
    expect: { intents: ['expense'], amountCents: 4500, account: 'Nubank', category: 'Alimentação' },
  },
  {
    text: 'comprei um tênis de 600 em 3x no crédito',
    expect: { intents: ['expense'], amountCents: 60000, installments: 3, account: 'Cartão Nubank' },
  },
  {
    text: 'farmácia 27,90',
    expect: { intents: ['expense'], amountCents: 2790, category: 'Saúde' },
  },
  {
    text: 'netflix 55,90 no cartão',
    expect: {
      intents: ['expense'],
      amountCents: 5590,
      account: 'Cartão Nubank',
      category: 'Assinaturas',
    },
  },
  {
    text: 'paguei o aluguel de 1800 pelo itaú',
    expect: { intents: ['expense'], amountCents: 180000, account: 'Itaú', category: 'Moradia' },
  },
  {
    text: 'cinema 60 conto sábado passado',
    expect: { intents: ['expense'], amountCents: 6000, date: '2026-10-10', category: 'Lazer' },
  },
  {
    text: 'gasolina 200 reais',
    expect: { intents: ['expense'], amountCents: 20000, category: 'Transporte' },
  },
  {
    text: 'almoço 38 em dinheiro',
    expect: {
      intents: ['expense'],
      amountCents: 3800,
      account: 'Carteira',
      category: 'Alimentação',
    },
  },
  {
    text: 'mensalidade do curso de inglês 350',
    expect: { intents: ['expense'], amountCents: 35000, category: 'Educação' },
  },
  {
    text: 'padaria 12',
    expect: { intents: ['expense'], amountCents: 1200, category: 'Alimentação' },
  },
  {
    text: 'conta de luz 230 no nubank',
    expect: { intents: ['expense'], amountCents: 23000, account: 'Nubank', category: 'Moradia' },
  },
  {
    text: 'gastei mil e duzentos no notebook em 10x no cartão',
    expect: {
      intents: ['expense'],
      amountCents: 120000,
      installments: 10,
      account: 'Cartão Nubank',
    },
  },
  {
    text: 'consulta médica 250 reais',
    expect: { intents: ['expense'], amountCents: 25000, category: 'Saúde' },
  },
  {
    text: 'spotify 21,90',
    expect: { intents: ['expense'], amountCents: 2190, category: 'Assinaturas' },
  },
  {
    text: 'feira 85 ontem na carteira',
    expect: {
      intents: ['expense'],
      amountCents: 8500,
      date: '2026-10-13',
      account: 'Carteira',
      category: 'Mercado',
    },
  },
  {
    text: 'estacionamento 15',
    expect: { intents: ['expense'], amountCents: 1500, category: 'Transporte' },
  },
  {
    text: '30 no uber e 50 no mercado',
    expect: { intents: ['expense', 'expense'], amountCents: 3000, category: 'Transporte' },
  },
  {
    text: 'pizza 89,90 sexta passada',
    expect: {
      intents: ['expense'],
      amountCents: 8990,
      date: '2026-10-09',
      category: 'Alimentação',
    },
  },
  // Receitas
  {
    text: 'recebi o salário de 5 mil no itaú',
    expect: { intents: ['income'], amountCents: 500000, account: 'Itaú', category: 'Salário' },
  },
  {
    text: 'caiu um pix de 150 do João',
    expect: { intents: ['income'], amountCents: 15000, category: 'Outras receitas' },
  },
  {
    text: 'vendi a bicicleta por 900',
    expect: { intents: ['income'], amountCents: 90000, category: 'Outras receitas' },
  },
  {
    text: 'recebi 320 de freela ontem no nubank',
    expect: { intents: ['income'], amountCents: 32000, date: '2026-10-13', account: 'Nubank' },
  },
  { text: 'reembolso de 75 da empresa', expect: { intents: ['income'], amountCents: 7500 } },
  // Transferências
  {
    text: 'guardei 500 na poupança',
    expect: { intents: ['transfer'], amountCents: 50000, toAccount: 'Poupança' },
  },
  {
    text: 'transferi 200 do itaú para o nubank',
    expect: { intents: ['transfer'], amountCents: 20000, account: 'Itaú', toAccount: 'Nubank' },
  },
  {
    text: 'paguei a fatura do cartão de 1.340 pelo nubank',
    expect: {
      intents: ['transfer'],
      amountCents: 134000,
      account: 'Nubank',
      toAccount: 'Cartão Nubank',
    },
  },
  {
    text: 'saquei 100 do nubank',
    expect: { intents: ['transfer'], amountCents: 10000, account: 'Nubank', toAccount: 'Carteira' },
  },
  // Eventos
  {
    text: 'dentista amanhã às 15h',
    expect: { intents: ['event'], date: '2026-10-15', time: '15:00', allDay: false },
  },
  {
    text: 'reunião com a Ana sexta das 10 às 11h30',
    expect: { intents: ['event'], date: '2026-10-16', time: '10:00', endTime: '11:30' },
  },
  {
    text: 'aniversário da minha mãe dia 20',
    expect: { intents: ['event'], date: '2026-10-20', allDay: true },
  },
  {
    text: 'marca academia segunda às 7 da manhã',
    expect: { intents: ['event'], date: '2026-10-19', time: '07:00' },
  },
  {
    text: 'jantar com o Pedro sábado às 8 da noite',
    expect: { intents: ['event'], date: '2026-10-17', time: '20:00' },
  },
  {
    text: 'consulta no oftalmologista dia 28 às 14h30',
    expect: { intents: ['event'], date: '2026-10-28', time: '14:30' },
  },
  {
    text: 'call com o cliente hoje meio-dia',
    expect: { intents: ['event'], date: TODAY, time: '12:00' },
  },
  {
    text: 'viagem para a praia de sexta a domingo',
    expect: { intents: ['event'], date: '2026-10-16', allDay: true },
  },
  // Tarefas
  {
    text: 'me lembra de pagar o IPVA sexta',
    expect: { intents: ['task'], date: '2026-10-16', list: 'Entrada' },
  },
  {
    text: 'comprar pão na lista do mercado',
    expect: { intents: ['task'], date: null, list: 'Mercado' },
  },
  {
    text: 'preciso mandar o relatório amanhã às 9h no trabalho',
    expect: { intents: ['task'], date: '2026-10-15', time: '09:00', list: 'Trabalho' },
  },
  { text: 'anota para ligar para o encanador', expect: { intents: ['task'], date: null } },
  {
    text: 'me lembra de tomar o remédio hoje às 22h',
    expect: { intents: ['task'], date: TODAY, time: '22:00' },
  },
  {
    text: 'marca dentista amanhã às 10h e me lembra de comprar pão',
    expect: { intents: ['event', 'task'], date: '2026-10-15', time: '10:00' },
  },
  // Perguntas
  { text: 'quanto gastei ontem com comida?', expect: { intents: ['question'] } },
  { text: 'qual o meu saldo?', expect: { intents: ['question'] } },
  { text: 'o que tenho amanhã?', expect: { intents: ['question'] } },
  { text: 'quanto falta no orçamento de mercado?', expect: { intents: ['question'] } },
  // Mudanças
  { text: 'apaga o último lançamento', expect: { intents: ['change'] } },
  { text: 'o uber de ontem foi 35', expect: { intents: ['change'] } },
  { text: 'marca a tarefa do IPVA como feita', expect: { intents: ['change'] } },
];

const nameOf = <T extends { id: string; name: string }>(rows: T[], id: string | null | undefined) =>
  rows.find((r) => r.id === id)?.name ?? null;

const MONEY = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

function describe(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (k === 'intents') return (v as string[]).join(' + ');
      if (k === 'amountCents' && typeof v === 'number') return MONEY(v);
      if (typeof v === 'boolean') return `${k}: ${v ? 'sim' : 'não'}`;
      return `${k}: ${v === null ? '—' : String(v)}`;
    })
    .join(' · ');
}

async function runCase(text: string, expect: Expect, options: Options) {
  const { today, accounts, categories, lists } = options;
  const extracted = await extractItems(text, options);
  let jevInput = 0;
  const got: Record<string, unknown> = { intents: extracted.items.map((i) => i.intent) };
  let autoSave = false;
  const first = extracted.items[0];
  if (first && isActionIntent(first.intent)) {
    const jev = await askJev(first, { accounts, categories, lists }).catch(() => null);
    jevInput = jev?.inputTokens ?? 0;
    const { draft, ...resolution } = resolveAction({
      item: first,
      accounts,
      categories,
      lists,
      jev: jev?.answers ?? null,
      today,
      usualAccountId: null,
    });
    autoSave = resolution.autoSave && extracted.items.every((i) => isActionIntent(i.intent));
    if (draft.type === 'transaction') {
      Object.assign(got, {
        amountCents: draft.amountCents,
        date: draft.date,
        account: nameOf(accounts, draft.accountId),
        toAccount: nameOf(accounts, draft.toAccountId),
        category: nameOf(categories, draft.categoryId),
        installments: draft.installments,
      });
    } else if (draft.type === 'event') {
      Object.assign(got, {
        date: draft.date,
        time: draft.startTime,
        endTime: draft.endTime,
        allDay: draft.allDay,
        notes: Boolean(draft.notes),
      });
    } else if (draft.type === 'task') {
      Object.assign(got, {
        date: draft.date,
        time: draft.time,
        list: draft.listId ? nameOf(lists, draft.listId) : (lists[0]?.name ?? 'Entrada'),
        notes: Boolean(draft.notes),
      });
    }
  }

  const problems: string[] = [];
  for (const [field, want] of Object.entries(expect)) {
    const have = got[field];
    const same = Array.isArray(want)
      ? JSON.stringify(want) === JSON.stringify(have)
      : (want ?? null) === (have ?? null);
    if (!same) problems.push(field);
  }
  const shown = Object.fromEntries(Object.keys(expect).map((k) => [k, got[k] ?? null]));
  const result: AssistantBenchmarkCase = {
    text,
    passed: problems.length === 0,
    expected: describe({ ...expect }),
    got: describe(shown),
    problems,
    autoSave,
    source: 'fixed',
    caseId: null,
  };
  return {
    result,
    usage: {
      modelInput: extracted.inputTokens,
      modelOutput: extracted.outputTokens,
      jevInput,
    },
  };
}

const CONCURRENCY = 5;

export function toTestCase(row: TestCaseRow): AssistantTestCase | null {
  const context = assistantTestContextSchema.safeParse(row.context);
  const expect = assistantTestExpectSchema.safeParse(row.expect);
  if (!context.success || !expect.success) return null;
  return {
    id: row.id,
    feedbackId: row.feedbackId,
    text: row.text,
    today: row.today,
    timezone: row.timezone,
    context: context.data,
    expect: expect.data,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface Planned {
  text: string;
  expect: Expect;
  options: Options;
  source: AssistantBenchmarkCase['source'];
  caseId: string | null;
}

/** Chave do caso para comparar rodadas: o id do caso real, ou o texto do exemplo. */
export const caseKey = (c: { caseId: string | null; text: string }) => c.caseId ?? c.text;

/** Os 50 fixos e os casos reais dados (os ativos). */
export function plannedFrom(testCases: AssistantTestCase[]): Planned[] {
  return [
    ...BENCHMARK_CASES.map(
      (c): Planned => ({ ...c, options: FIXED, source: 'fixed', caseId: null })
    ),
    ...testCases
      .filter((c) => c.active)
      .map(
        (c): Planned => ({
          text: c.text,
          expect: c.expect as Expect,
          options: optionsFromContext(c.today, c.timezone, c.context),
          source: 'real',
          caseId: c.id,
        })
      ),
  ];
}

export async function activeTestCases(): Promise<AssistantTestCase[]> {
  const rows = await prisma.assistantTestCase.findMany({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.flatMap((row) => toTestCase(row) ?? []);
}

export interface Prices {
  haikuInput: number;
  haikuOutput: number;
  jevInput: number;
}

export interface BenchmarkUsage {
  modelInput: number;
  modelOutput: number;
  jevInput: number;
}

/** Roda os casos (5 de cada vez), sem tocar no banco. */
export async function runCases(planned: Planned[]) {
  const started = Date.now();
  const cases: AssistantBenchmarkCase[] = new Array(planned.length);
  const usage: BenchmarkUsage = { modelInput: 0, modelOutput: 0, jevInput: 0 };
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < planned.length) {
        const index = next++;
        const { text, expect, options, source, caseId } = planned[index];
        try {
          const run = await runCase(text, expect, options);
          cases[index] = { ...run.result, source, caseId };
          usage.modelInput += run.usage.modelInput;
          usage.modelOutput += run.usage.modelOutput;
          usage.jevInput += run.usage.jevInput;
        } catch {
          cases[index] = {
            text,
            passed: false,
            expected: describe({ ...expect }),
            got: 'o Haiku falhou',
            problems: ['haiku'],
            autoSave: false,
            source,
            caseId,
          };
        }
      }
    })
  );
  return { cases, usage, ms: Date.now() - started };
}

export const costOf = (usage: BenchmarkUsage, prices: Prices) =>
  Math.round(
    usage.modelInput * prices.haikuInput +
      usage.modelOutput * prices.haikuOutput +
      usage.jevInput * prices.jevInput
  );

export function summarize(
  cases: AssistantBenchmarkCase[],
  ms: number,
  costMicros: number
): AssistantBenchmarkResponse {
  return {
    ranAt: new Date().toISOString(),
    total: cases.length,
    passed: cases.filter((c) => c.passed).length,
    autoSavedRight: cases.filter((c) => c.autoSave && c.passed).length,
    autoSavedWrong: cases.filter((c) => c.autoSave && !c.passed).length,
    ms,
    costMicros,
    cases,
  };
}

/** Guarda a rodada no histórico e o custo (fora do limite do mês), no nome do dono. */
export async function recordRun(
  userId: string,
  result: AssistantBenchmarkResponse,
  usage: BenchmarkUsage,
  meta: {
    source: 'PANEL' | 'CI';
    commit?: string | null;
    label?: string | null;
    regressions?: number;
  }
) {
  await prisma.assistantUsage.create({
    data: {
      userId,
      kind: 'BENCHMARK',
      jevInputTokens: usage.jevInput,
      modelInputTokens: usage.modelInput,
      modelOutputTokens: usage.modelOutput,
      costMicros: result.costMicros,
    },
  });
  await prisma.assistantBenchmarkRun.create({
    data: {
      source: meta.source,
      commit: meta.commit ?? null,
      label: meta.label ?? null,
      total: result.total,
      passed: result.passed,
      autoSavedWrong: result.autoSavedWrong,
      regressions: meta.regressions ?? 0,
      costMicros: result.costMicros,
      ms: result.ms,
      cases: result.cases as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Roda os 50 pedidos e os casos reais pelo painel, e guarda a rodada. */
export async function runBenchmark(
  userId: string,
  prices: Prices
): Promise<AssistantBenchmarkResponse> {
  const { cases, usage, ms } = await runCases(plannedFrom(await activeTestCases()));
  const result = summarize(cases, ms, costOf(usage, prices));
  await recordRun(userId, result, usage, { source: 'PANEL' });
  return result;
}
