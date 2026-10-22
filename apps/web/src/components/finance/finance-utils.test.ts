import type {
  BudgetStatusResponse,
  CategoryResponse,
  InvoiceResponse,
  TransactionResponse,
} from '@jottape/schemas';
import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  availableBalance,
  axisTicks,
  budgetBar,
  categorySlices,
  categoryTree,
  compactMoney,
  comparisonText,
  defaultStatus,
  filterTransactions,
  forecastAt,
  futureInvoiceIds,
  groupByDay,
  groupInvoices,
  hasCardsAndAccounts,
  installmentLabel,
  installmentPreview,
  invoiceTitle,
  lastDayOfMonth,
  NO_FILTERS,
  orderedPeriod,
  repetitionFields,
  resolveMonth,
  scopeAccountIds,
  shiftMonth,
  signedAmount,
  type StatementFilters,
  styledCategory,
  totalsOf,
  zeroCrossingOffset,
} from './finance-utils';

const nbsp = (text: string) => text.replace(/\u00a0/g, ' ');

function tx(overrides: Partial<TransactionResponse>): TransactionResponse {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'EXPENSE',
    amountCents: 1000,
    date: '2026-10-10',
    accountId: 'a1',
    toAccountId: null,
    categoryId: null,
    description: 'Mercado',
    notes: null,
    status: 'DONE',
    recurrenceId: null,
    recurrenceRule: null,
    installmentGroupId: null,
    installmentNumber: null,
    installmentTotal: null,
    invoiceId: null,
    paysInvoiceId: null,
    ...overrides,
  };
}

const cat = (overrides: Partial<CategoryResponse>): CategoryResponse => ({
  id: 'c',
  name: 'Categoria',
  kind: 'EXPENSE',
  parentId: null,
  icon: null,
  color: null,
  ...overrides,
});

describe('meses', () => {
  it('usa o mês da URL só quando é válido', () => {
    expect(resolveMonth('2026-03', '2026-10-18')).toBe('2026-03');
    expect(resolveMonth('2026-13', '2026-10-18')).toBe('2026-10');
    expect(resolveMonth(undefined, '2026-10-18')).toBe('2026-10');
  });

  it('anda entre meses atravessando o ano', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });

  it('acha o último dia do mês', () => {
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
    expect(lastDayOfMonth('2026-10')).toBe('2026-10-31');
  });
});

describe('agrupamento por dia', () => {
  it('agrupa do dia mais recente para o mais antigo, mantendo a ordem dentro do dia', () => {
    const list = [
      tx({ id: '1', date: '2026-10-02' }),
      tx({ id: '2', date: '2026-10-15' }),
      tx({ id: '3', date: '2026-10-02', kind: 'INCOME', amountCents: 5000 }),
    ];
    const groups = groupByDay(list);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-15', '2026-10-02']);
    expect(groups[1].items.map((t) => t.id)).toEqual(['1', '3']);
    expect(groups[1].totalCents).toBe(4000);
  });

  it('dá sinal às transferências só no extrato de uma conta', () => {
    const transfer = tx({ kind: 'TRANSFER', accountId: 'a1', toAccountId: 'a2', amountCents: 300 });
    expect(groupByDay([transfer])[0].totalCents).toBe(0);
    expect(groupByDay([transfer], 'a1')[0].totalCents).toBe(-300);
    expect(groupByDay([transfer], 'a2')[0].totalCents).toBe(300);
  });

  it('lista vazia dá nenhum grupo', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('totais', () => {
  const list = [
    tx({ kind: 'INCOME', amountCents: 10000 }),
    tx({ kind: 'INCOME', amountCents: 2000, status: 'PLANNED' }),
    tx({ kind: 'EXPENSE', amountCents: 3000 }),
    tx({ kind: 'EXPENSE', amountCents: 500, status: 'PLANNED' }),
    tx({ kind: 'TRANSFER', amountCents: 7000, accountId: 'a1', toAccountId: 'a2' }),
  ];

  it('soma entradas e saídas sem contar transferências', () => {
    expect(totalsOf(list)).toEqual({
      incomeCents: 12000,
      expenseCents: 3500,
      netCents: 8500,
      plannedIncomeCents: 2000,
      plannedExpenseCents: 500,
    });
  });

  it('numa conta, a transferência que sai é saída', () => {
    expect(totalsOf(list, 'a1').expenseCents).toBe(10500);
    expect(totalsOf(list, 'a2').incomeCents).toBe(19000);
  });

  it('saldo disponível ignora cartões e arquivadas', () => {
    const base = {
      name: 'x',
      initialBalanceCents: 0,
      color: null,
      closingDay: null,
      dueDay: null,
      paymentAccountId: null,
      expectedBalanceCents: 0,
      openInvoiceCents: null,
    };
    expect(
      availableBalance([
        { ...base, id: '1', type: 'CHECKING', archived: false, balanceCents: 1000 },
        { ...base, id: '2', type: 'WALLET', archived: false, balanceCents: -200 },
        { ...base, id: '3', type: 'CREDIT_CARD', archived: false, balanceCents: -9000 },
        { ...base, id: '4', type: 'SAVINGS', archived: true, balanceCents: 5000 },
      ])
    ).toBe(800);
  });
});

describe('filtros do extrato', () => {
  const list = [
    tx({ id: 'in', kind: 'INCOME', description: 'Salário' }),
    tx({ id: 'out', description: 'Açougue' }),
    tx({ id: 'plan', description: 'Aluguel', status: 'PLANNED' }),
  ];
  const ids = (result: TransactionResponse[]) => result.map((t) => t.id);

  const only = (filters: Partial<StatementFilters>) => ({ ...NO_FILTERS, ...filters });

  it('filtra por tipo e por previstos, que combinam', () => {
    expect(ids(filterTransactions(list, NO_FILTERS))).toEqual(['in', 'out', 'plan']);
    expect(ids(filterTransactions(list, only({ kind: 'income' })))).toEqual(['in']);
    expect(ids(filterTransactions(list, only({ kind: 'expense' })))).toEqual(['out', 'plan']);
    expect(ids(filterTransactions(list, only({ planned: true })))).toEqual(['plan']);
    expect(ids(filterTransactions(list, only({ kind: 'income', planned: true })))).toEqual([]);
  });

  it('conta os filtros ligados e põe o período em ordem', () => {
    expect(activeFilterCount(NO_FILTERS, null)).toBe(0);
    const period = { from: '2026-10-01', to: '2026-10-15' };
    expect(activeFilterCount({ kind: 'expense', planned: true }, period)).toBe(3);
    expect(orderedPeriod({ from: '2026-10-15', to: '2026-10-01' })).toEqual(period);
    expect(orderedPeriod(period)).toEqual(period);
  });

  it('busca sem diferenciar maiúsculas nem acentos', () => {
    expect(ids(filterTransactions(list, NO_FILTERS, 'acougue'))).toEqual(['out']);
    expect(ids(filterTransactions(list, NO_FILTERS, '  SAL '))).toEqual(['in']);
  });
});

describe('contas e cartões no extrato', () => {
  const accounts = [
    { id: 'cc', type: 'CHECKING' as const },
    { id: 'poup', type: 'SAVINGS' as const },
    { id: 'card', type: 'CREDIT_CARD' as const },
  ];
  const list = [
    tx({ id: 'salario', kind: 'INCOME', accountId: 'cc', amountCents: 500000 }),
    tx({ id: 'pix', accountId: 'cc', amountCents: 3000 }),
    tx({ id: 'compra', accountId: 'card', amountCents: 12000 }),
    tx({
      id: 'fatura',
      kind: 'TRANSFER',
      accountId: 'cc',
      toAccountId: 'card',
      amountCents: 80000,
    }),
    tx({
      id: 'guardar',
      kind: 'TRANSFER',
      accountId: 'cc',
      toAccountId: 'poup',
      amountCents: 1000,
    }),
  ];
  const ids = (result: TransactionResponse[]) => result.map((t) => t.id);
  const contas = scopeAccountIds(accounts, 'accounts')!;
  const cartoes = scopeAccountIds(accounts, 'cards')!;

  it('separa as contas dos cartões', () => {
    expect(scopeAccountIds(accounts, 'all')).toBeUndefined();
    expect([...contas]).toEqual(['cc', 'poup']);
    expect([...cartoes]).toEqual(['card']);
  });

  it('o pagamento da fatura aparece nos dois lados', () => {
    expect(ids(filterTransactions(list, NO_FILTERS, '', contas))).toEqual([
      'salario',
      'pix',
      'fatura',
      'guardar',
    ]);
    expect(ids(filterTransactions(list, NO_FILTERS, '', cartoes))).toEqual(['compra', 'fatura']);
  });

  it('a fatura sai das contas e entra no cartão; transferência entre contas fica neutra', () => {
    const fatura = list[3];
    expect(signedAmount(fatura, contas)).toBe(-80000);
    expect(signedAmount(fatura, cartoes)).toBe(80000);
    expect(signedAmount(list[4], contas)).toBe(0);
    expect(totalsOf(filterTransactions(list, NO_FILTERS, '', contas), contas)).toMatchObject({
      incomeCents: 500000,
      expenseCents: 83000,
    });
    expect(ids(filterTransactions(list, { kind: 'expense', planned: false }, '', cartoes))).toEqual(
      ['compra']
    );
  });

  it('só oferece o recorte quando há cartão e conta', () => {
    expect(hasCardsAndAccounts(accounts)).toBe(true);
    expect(hasCardsAndAccounts(accounts.slice(0, 2))).toBe(false);
    expect(hasCardsAndAccounts(accounts.slice(2))).toBe(false);
  });
});

describe('parcelas', () => {
  it('mostra a primeira parcela, que leva os centavos que sobram', () => {
    expect(nbsp(installmentPreview(10000, 3)!)).toBe('3× de R$ 33,34');
    expect(nbsp(installmentPreview(9000, 3)!)).toBe('3× de R$ 30,00');
  });

  it('não mostra prévia sem valor', () => {
    expect(installmentPreview(0, 3)).toBeNull();
    expect(installmentPreview(1000, 1)).toBeNull();
  });

  it('rótulo "2/3"', () => {
    expect(installmentLabel({ installmentNumber: 2, installmentTotal: 3 })).toBe('2/3');
    expect(installmentLabel({ installmentNumber: null, installmentTotal: null })).toBeNull();
  });

  it('monta o corpo de repetição sem misturar recorrência e parcelas', () => {
    expect(repetitionFields('none', 5)).toEqual({});
    expect(repetitionFields('installments', 99)).toEqual({ installments: 72 });
    expect(repetitionFields('installments', 1)).toEqual({ installments: 2 });
    expect(repetitionFields('monthly', 5)).toEqual({ recurrence: { rrule: 'FREQ=MONTHLY' } });
    expect(repetitionFields('weekly', 5)).toEqual({ recurrence: { rrule: 'FREQ=WEEKLY' } });
  });

  it('status padrão: pago até hoje, previsto depois', () => {
    expect(defaultStatus('2026-10-18', '2026-10-18')).toBe('DONE');
    expect(defaultStatus('2026-10-19', '2026-10-18')).toBe('PLANNED');
  });
});

describe('gráfico de previsão', () => {
  it('zero no meio da faixa', () => {
    expect(zeroCrossingOffset([300, -100])).toBeCloseTo(0.75);
    expect(zeroCrossingOffset([100, -100, 50])).toBeCloseTo(0.5);
  });

  it('tudo positivo fica verde; tudo negativo, vermelho', () => {
    expect(zeroCrossingOffset([10, 20])).toBe(1);
    expect(zeroCrossingOffset([0, 20])).toBe(1);
    expect(zeroCrossingOffset([-10, -20])).toBe(0);
    expect(zeroCrossingOffset([])).toBe(1);
  });

  it('valor no fim do mês, ou o último disponível', () => {
    const forecast = {
      start: '2026-10-18',
      firstNegative: null,
      days: [
        { date: '2026-10-30', totalCents: 1, byAccount: {} },
        { date: '2026-10-31', totalCents: 2, byAccount: {} },
        { date: '2026-11-01', totalCents: 3, byAccount: {} },
      ],
    };
    expect(forecastAt(forecast, '2026-10-31')?.totalCents).toBe(2);
    expect(
      forecastAt({ ...forecast, days: forecast.days.slice(0, 1) }, '2026-10-31')?.totalCents
    ).toBe(1);
    expect(forecastAt(undefined, '2026-10-31')).toBeNull();
  });

  it('poucos rótulos no eixo, com as pontas', () => {
    const dates = Array.from({ length: 30 }, (_, i) => `d${i}`);
    expect(axisTicks(dates, 4)).toEqual(['d0', 'd10', 'd19', 'd29']);
    expect(axisTicks(['a', 'b'], 4)).toEqual(['a', 'b']);
  });

  it('valores compactos no eixo', () => {
    expect(compactMoney(200000)).toBe('2 mil');
    expect(compactMoney(150000)).toBe('1,5 mil');
    expect(compactMoney(50000)).toBe('500');
    expect(compactMoney(-30000)).toBe('−300');
    expect(compactMoney(250000000)).toBe('2,5 mi');
  });
});

describe('resumo', () => {
  it('compara com o mês anterior', () => {
    expect(comparisonText(880, 1000, 'setembro')).toBe('12% menos que setembro');
    expect(comparisonText(1500, 1000, 'setembro')).toBe('50% mais que setembro');
    expect(comparisonText(1000, 1000, 'setembro')).toBe('Igual a setembro');
    expect(comparisonText(1000, 0, 'setembro')).toBeNull();
  });

  it('fatias com cor herdada da mãe e percentual', () => {
    const all = [
      cat({ id: 'casa', name: 'Casa', color: '#ff0000', icon: 'home' }),
      cat({ id: 'luz', name: 'Luz', parentId: 'casa' }),
    ];
    const slices = categorySlices(
      [
        { categoryId: 'luz', totalCents: 100 },
        { categoryId: null, totalCents: 300 },
        { categoryId: 'casa', totalCents: 0 },
      ],
      all
    );
    expect(slices.map((s) => [s.name, s.color, s.percent])).toEqual([
      ['Sem categoria', 'var(--gray)', 75],
      ['Casa › Luz', '#ff0000', 25],
    ]);
  });

  it('herda ícone e cor da categoria-mãe', () => {
    const parent = cat({ id: 'p', color: '#00ff00', icon: 'car' });
    expect(styledCategory(cat({ id: 'f', parentId: 'p', icon: 'tag' }), [parent])).toMatchObject({
      color: '#00ff00',
      icon: 'tag',
    });
    expect(styledCategory(null, [parent])).toBeNull();
  });

  it('opções de categoria: mãe seguida das filhas, só do tipo pedido', () => {
    const all = [
      cat({ id: 'b', name: 'Transporte' }),
      cat({ id: 'a', name: 'Casa' }),
      cat({ id: 'a2', name: 'Luz', parentId: 'a' }),
      cat({ id: 'i', name: 'Salário', kind: 'INCOME' }),
    ];
    const tree = categoryTree(all, 'EXPENSE');
    expect(tree.map((g) => [g.parent.name, g.children.map((c) => c.name)])).toEqual([
      ['Casa', ['Luz']],
      ['Transporte', []],
    ]);
    expect(categoryTree(all, 'INCOME').map((g) => g.parent.id)).toEqual(['i']);
    expect(categoryTree(all, 'TRANSFER')).toEqual([]);
  });
});

describe('orçamentos', () => {
  const budget = (
    spentCents: number,
    plannedCents = 0
  ): Pick<BudgetStatusResponse, 'limitCents' | 'spentCents' | 'plannedCents'> => ({
    limitCents: 50000,
    spentCents,
    plannedCents,
  });

  it('níveis ok, alerta e estourado', () => {
    expect(budgetBar(budget(10000)).level).toBe('ok');
    expect(budgetBar(budget(40000)).level).toBe('warn');
    expect(budgetBar(budget(50000)).level).toBe('over');
  });

  it('o previsto estende a barra sem passar de 100%', () => {
    expect(budgetBar(budget(42000, 5000))).toMatchObject({
      spentWidth: 84,
      plannedWidth: 10,
      remainingCents: 8000,
    });
    expect(budgetBar(budget(45000, 20000)).plannedWidth).toBe(10);
    expect(budgetBar(budget(60000, 1000))).toMatchObject({ spentWidth: 100, plannedWidth: 0 });
  });
});

describe('faturas', () => {
  it('título com ano só quando não é o atual', () => {
    expect(invoiceTitle('2026-10', 'outubro', '2026-10-18')).toBe('Fatura de outubro');
    expect(invoiceTitle('2025-12', 'dezembro', '2026-10-18')).toBe('Fatura de dezembro de 2025');
  });
});

describe('faturas do cartão', () => {
  it('põe as que faltam pagar primeiro, da mais próxima, e as pagas da mais recente', () => {
    const invoice = (id: string, dueDate: string, status: InvoiceResponse['status']) =>
      ({ id, dueDate, status }) as InvoiceResponse;
    const groups = groupInvoices([
      invoice('ago', '2026-08-10', 'PAID'),
      invoice('dez', '2026-12-10', 'OPEN'),
      invoice('set', '2026-09-10', 'PAID'),
      invoice('nov', '2026-11-10', 'CLOSED'),
    ]);
    expect(groups.map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ['A pagar', ['nov', 'dez']],
      ['Pagas', ['set', 'ago']],
    ]);
  });

  it('só a primeira aberta de cada cartão está correndo; as outras são futuras', () => {
    const invoice = (id: string, accountId: string, closingDate: string, status = 'OPEN') =>
      ({ id, accountId, closingDate, status }) as InvoiceResponse;
    const future = futureInvoiceIds([
      invoice('mp-dez', 'mp', '2026-12-01'),
      invoice('mp-out', 'mp', '2026-10-01', 'CLOSED'),
      invoice('mp-nov', 'mp', '2026-11-01'),
      invoice('c6-nov', 'c6', '2026-11-10'),
      invoice('mp-jan', 'mp', '2027-01-01'),
    ]);
    expect([...future].sort()).toEqual(['mp-dez', 'mp-jan']);
  });
});
