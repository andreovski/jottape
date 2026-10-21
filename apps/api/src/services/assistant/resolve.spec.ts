import { describe, expect, it } from 'vitest';

import {
  type AccountOption,
  NO_LIST,
  resolveEvent,
  resolveTask,
  type CategoryOption,
  type ExtractedItem,
  type FinanceIntent,
  matchByName,
  NO_ACCOUNT,
  resolveDate,
  resolveItem,
} from './resolve';
import { extractMoney, replyText, restoreMoney } from './text';

const accounts: AccountOption[] = [
  { id: 'a-nubank', name: 'Nubank', type: 'CHECKING' },
  { id: 'a-carteira', name: 'Carteira', type: 'WALLET' },
  { id: 'a-cartao', name: 'Cartão Nubank', type: 'CREDIT_CARD' },
];
const categories: CategoryOption[] = [
  { id: 'c-alimentacao', name: 'Alimentação', kind: 'EXPENSE' },
  { id: 'c-transporte', name: 'Transporte', kind: 'EXPENSE' },
  { id: 'c-salario', name: 'Salário', kind: 'INCOME' },
];
const TODAY = '2026-10-20';

function item(
  overrides: Partial<ExtractedItem> & { intent?: FinanceIntent } = {}
): ExtractedItem & { intent: FinanceIntent } {
  return {
    intent: 'expense',
    excerpt: 'gastei 30 no uber no nubank',
    amountCents: 3000,
    description: 'Uber',
    date: null,
    account: 'Nubank',
    toAccount: null,
    category: 'Transporte',
    installments: null,
    time: null,
    endTime: null,
    allDay: false,
    list: null,
    location: null,
    confidence: 0.95,
    ...overrides,
  } as ExtractedItem & { intent: FinanceIntent };
}

const sure = (choice: string) => ({ choice, probabilities: { [choice]: 0.97 } });

describe('matchByName', () => {
  it('ignora acento e caixa, e não chuta quando é ambíguo', () => {
    expect(matchByName(categories, 'alimentacao')?.id).toBe('c-alimentacao');
    expect(matchByName(accounts, 'carteira')?.id).toBe('a-carteira');
    // "Nubank" é exato; "nubank" casaria com as duas por "contém".
    expect(matchByName(accounts, 'NUBANK')?.id).toBe('a-nubank');
    expect(matchByName(accounts, 'banco')).toBeNull();
    expect(matchByName(accounts, null)).toBeNull();
  });
});

describe('resolveDate', () => {
  it('aceita datas perto de hoje e cai para hoje no resto', () => {
    expect(resolveDate('2026-10-19', TODAY)).toBe('2026-10-19');
    expect(resolveDate(null, TODAY)).toBe(TODAY);
    expect(resolveDate('2026-02-30', TODAY)).toBe(TODAY);
    expect(resolveDate('2019-01-01', TODAY)).toBe(TODAY);
    expect(resolveDate('ontem', TODAY)).toBe(TODAY);
  });
});

describe('resolveItem', () => {
  it('salva sozinho quando Haiku e Jev concordam com certeza', () => {
    const result = resolveItem({
      item: item(),
      accounts,
      categories,
      jev: { kind: sure('expense'), account: sure('opcao_1'), category: sure('opcao_2') },
      today: TODAY,
      usualAccountId: null,
    });
    expect(result.draft).toEqual({
      type: 'transaction',
      kind: 'EXPENSE',
      amountCents: 3000,
      date: TODAY,
      accountId: 'a-nubank',
      toAccountId: null,
      categoryId: 'c-transporte',
      description: 'Uber',
      installments: null,
    });
    expect(result.missing).toEqual([]);
    expect(result.uncertain).toEqual([]);
    expect(result.score).toBe(0.95);
    expect(result.autoSave).toBe(true);
  });

  it('sem o Jev, nunca salva sozinho', () => {
    const result = resolveItem({
      item: item({ confidence: 1 }),
      accounts,
      categories,
      jev: null,
      today: TODAY,
      usualAccountId: null,
    });
    expect(result.score).toBe(0.8);
    expect(result.autoSave).toBe(false);
    expect(result.missing).toEqual([]);
  });

  it('quando o Jev discorda do tipo, o score cai e o tipo fica marcado', () => {
    const result = resolveItem({
      item: item(),
      accounts,
      categories,
      jev: {
        kind: { choice: 'transfer', probabilities: { expense: 0.4, transfer: 0.6 } },
        account: sure('opcao_1'),
        category: sure('opcao_2'),
      },
      today: TODAY,
      usualAccountId: null,
    });
    expect(result.score).toBe(0.4);
    expect(result.uncertain).toEqual(['kind']);
    expect(result.autoSave).toBe(false);
  });

  it('sem conta no pedido, sugere a mais usada e pede confirmação', () => {
    const result = resolveItem({
      item: item({ account: null }),
      accounts,
      categories,
      jev: { kind: sure('expense'), account: sure(NO_ACCOUNT), category: sure('opcao_2') },
      today: TODAY,
      usualAccountId: 'a-carteira',
    });
    expect(result.draft.accountId).toBe('a-carteira');
    expect(result.uncertain).toEqual(['account']);
    expect(result.autoSave).toBe(false);
  });

  it('usa a conta que o Jev achou quando o Haiku não nomeou', () => {
    const result = resolveItem({
      item: item({ account: null }),
      accounts,
      categories,
      jev: { kind: sure('expense'), account: sure('opcao_3'), category: sure('opcao_2') },
      today: TODAY,
      usualAccountId: null,
    });
    expect(result.draft.accountId).toBe('a-cartao');
    expect(result.autoSave).toBe(true);
  });

  it('marca o que falta: valor e conta de destino', () => {
    const result = resolveItem({
      item: item({
        intent: 'transfer',
        amountCents: null,
        account: 'Nubank',
        toAccount: null,
        category: null,
        description: '',
      }),
      accounts,
      categories,
      jev: { kind: sure('transfer'), account: sure('opcao_1'), toAccount: sure(NO_ACCOUNT) },
      today: TODAY,
      usualAccountId: null,
    });
    expect(result.missing).toEqual(['amount', 'toAccount']);
    expect(result.draft.description).toBe('Transferência');
    expect(result.draft.categoryId).toBeNull();
    expect(result.autoSave).toBe(false);
  });

  it('receita não cai em cartão de crédito e categoria de outro tipo não vale', () => {
    const result = resolveItem({
      item: item({
        intent: 'income',
        account: 'Cartão Nubank',
        category: 'Transporte',
        description: 'Salário',
        installments: 3,
      }),
      accounts,
      categories,
      jev: null,
      today: TODAY,
      usualAccountId: null,
    });
    expect(result.draft.accountId).toBeNull();
    expect(result.draft.categoryId).toBeNull();
    expect(result.draft.installments).toBeNull();
    expect(result.missing).toEqual(['account']);
  });

  it('com uma conta só, ela é a conta', () => {
    const result = resolveItem({
      item: item({ account: null }),
      accounts: [accounts[0]],
      categories,
      jev: { kind: sure('expense'), account: sure(NO_ACCOUNT), category: sure('opcao_2') },
      today: TODAY,
      usualAccountId: null,
    });
    expect(result.draft.accountId).toBe('a-nubank');
    expect(result.autoSave).toBe(true);
  });
});

describe('replyText', () => {
  it('fala do que salvou, do que falta e do que ainda não sabe fazer', () => {
    expect(replyText([{ type: 'transaction', saved: true, missing: [] }], [])).toBe(
      'Pronto, salvei.'
    );
    expect(
      replyText([{ type: 'transaction', saved: false, missing: ['amount', 'account'] }], [])
    ).toBe('Falta o valor e a conta para salvar.');
    expect(
      replyText(
        [
          { type: 'transaction', saved: true, missing: [] },
          { type: 'transaction', saved: false, missing: [] },
        ],
        []
      )
    ).toBe('Pronto, salvei. O outro ficou para você conferir.');
    expect(replyText([{ type: 'event', saved: true, missing: [] }], [])).toBe(
      'Pronto, está na agenda.'
    );
    expect(replyText([{ type: 'event', saved: false, missing: ['time'] }], [])).toBe(
      'Falta o horário para salvar.'
    );
    expect(replyText([], ['question'], 'Você gastou {0} ontem.')).toBe('Você gastou {0} ontem.');
    expect(replyText([], ['question'], null)).toMatch(/^Não consegui responder/);
    expect(replyText([{ type: 'task', saved: true, missing: [] }], ['question'], 'Tem {0}.')).toBe(
      'Pronto, anotei nas tarefas. Tem {0}.'
    );
    expect(replyText([], ['other'])).toMatch(/^Não entendi/);
  });
});

describe('resolveEvent', () => {
  const event = (overrides: Partial<ExtractedItem>) =>
    item({ intent: 'event' as never, description: 'Dentista', excerpt: 'dentista', ...overrides });

  it('com horário e Jev de acordo, salva sozinho e dura uma hora', () => {
    const result = resolveEvent({
      item: event({ date: '2026-10-21', time: '15:00' }),
      jev: { kind: sure('event') },
      today: TODAY,
    });
    expect(result.draft).toEqual({
      type: 'event',
      title: 'Dentista',
      date: '2026-10-21',
      startTime: '15:00',
      endTime: '16:00',
      allDay: false,
      location: null,
    });
    expect(result.autoSave).toBe(true);
  });

  it('sem horário falta o horário; dia todo não precisa; fim não passa da meia-noite', () => {
    expect(resolveEvent({ item: event({}), jev: null, today: TODAY }).missing).toEqual(['time']);
    const allDay = resolveEvent({
      item: event({ allDay: true, time: '10:00' }),
      jev: null,
      today: TODAY,
    });
    expect(allDay.missing).toEqual([]);
    expect(allDay.draft).toMatchObject({ allDay: true, startTime: null, endTime: null });
    const late = resolveEvent({ item: event({ time: '23:30' }), jev: null, today: TODAY });
    expect(late.draft).toMatchObject({ startTime: '23:30', endTime: '23:59' });
  });
});

describe('resolveTask', () => {
  const lists = [
    { id: 'l-entrada', name: 'Entrada' },
    { id: 'l-mercado', name: 'Mercado' },
  ];
  const task = (overrides: Partial<ExtractedItem>) =>
    item({
      intent: 'task' as never,
      description: 'Comprar pão',
      excerpt: 'comprar pão',
      ...overrides,
    });

  it('vai para a lista nomeada, com prazo só quando tem data', () => {
    const result = resolveTask({
      item: task({ list: 'mercado', time: '18:00' }),
      lists,
      jev: { kind: sure('task'), list: sure('opcao_2') },
      today: TODAY,
    });
    expect(result.draft).toEqual({
      type: 'task',
      title: 'Comprar pão',
      date: null,
      time: null,
      listId: 'l-mercado',
    });
    expect(result.autoSave).toBe(true);
  });

  it('lista que não existe cai na Entrada e fica marcada', () => {
    const result = resolveTask({
      item: task({ list: 'trabalho', date: '2026-10-23' }),
      lists,
      jev: { kind: sure('task'), list: sure(NO_LIST) },
      today: TODAY,
    });
    expect(result.draft).toMatchObject({ listId: null, date: '2026-10-23' });
    expect(result.uncertain).toEqual(['list']);
    expect(result.autoSave).toBe(false);
  });
});

describe('extractMoney', () => {
  it('troca [[centavos]] por marcadores e não deixa chave solta virar valor', () => {
    expect(extractMoney('Você gastou R$ [[3250]] ontem, [[ 1000 ]] no iFood.')).toEqual({
      text: 'Você gastou {0} ontem, {1} no iFood.',
      values: [3250, 1000],
    });
    expect(extractMoney('Saldo de [[-500]] {0}')).toEqual({
      text: 'Saldo de {0} (0)',
      values: [-500],
    });
    expect(restoreMoney('Você gastou {0} e {1}.', [3250, 10])).toBe(
      'Você gastou [[3250]] e [[10]].'
    );
  });
});
