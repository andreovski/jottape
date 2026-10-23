import type {
  AccountResponse,
  CategoryResponse,
  InvoiceResponse,
  TransactionResponse,
} from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { extendRecurrences } from '@/services/finance';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

// 18/10/2026, meio-dia em São Paulo.
const NOW = new Date('2026-10-18T15:00:00Z');

describe('finanças', () => {
  let api: ReturnType<typeof client>;
  let checking: AccountResponse;
  let card: AccountResponse;
  let expenseCategory: string;

  beforeAll(() => app.ready());
  afterAll(() => app.close());
  afterEach(() => vi.useRealTimers());

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    await resetDatabase();
    const { cookie, user } = await loginAsOwner(app);
    api = client(app, cookie);

    checking = (
      await api.post('/accounts', {
        name: 'Nubank',
        type: 'CHECKING',
        initialBalanceCents: 1000_00,
      })
    ).json();
    card = (
      await api.post('/accounts', {
        name: 'Cartão',
        type: 'CREDIT_CARD',
        closingDay: 25,
        dueDay: 5,
        paymentAccountId: checking.id,
      })
    ).json();
    expenseCategory = (
      await prisma.category.findFirstOrThrow({ where: { userId: user.id, name: 'Mercado' } })
    ).id;
  });

  const accounts = async () => (await api.get('/accounts')).json() as AccountResponse[];
  const byId = async (id: string) => (await accounts()).find((a) => a.id === id)!;

  it('Transferência é fixa: Pix, Débito e Crédito em entradas e saídas, sem apagar nem renomear', async () => {
    const categories = (await api.get('/categories')).json() as CategoryResponse[];
    const fixed = categories.filter((c) => c.systemKey);
    expect(fixed).toHaveLength(8);
    for (const kind of ['INCOME', 'EXPENSE'] as const) {
      const parent = fixed.find((c) => c.kind === kind && c.systemKey === 'TRANSFER')!;
      expect(parent).toMatchObject({ name: 'Transferência', parentId: null });
      expect(
        fixed
          .filter((c) => c.parentId === parent.id)
          .map((c) => c.name)
          .sort()
      ).toEqual(['Crédito', 'Débito', 'Pix']);
    }
    const pix = fixed.find((c) => c.kind === 'EXPENSE' && c.systemKey === 'TRANSFER_PIX')!;
    expect((await api.delete(`/categories/${pix.id}`)).statusCode).toBe(409);
    expect((await api.patch(`/categories/${pix.id}`, { name: 'Pix enviado' })).statusCode).toBe(
      409
    );
    expect((await api.patch(`/categories/${pix.id}`, { parentId: null })).statusCode).toBe(409);
    const recolored = await api.patch(`/categories/${pix.id}`, {
      name: 'Pix',
      color: '#ff9500',
      icon: 'coins',
    });
    expect(recolored.json()).toMatchObject({ name: 'Pix', color: '#ff9500', icon: 'coins' });
    // Dentro dela dá para criar outras.
    const parent = fixed.find((c) => c.kind === 'EXPENSE' && c.systemKey === 'TRANSFER')!;
    const own = await api.post('/categories', {
      name: 'Boleto',
      kind: 'EXPENSE',
      parentId: parent.id,
    });
    expect(own.statusCode).toBe(201);
    expect((await api.delete(`/categories/${own.json().id}`)).statusCode).toBe(204);
  });

  it('valida o cartão sem dias de fechamento', async () => {
    const response = await api.post('/accounts', { name: 'X', type: 'CREDIT_CARD' });
    expect(response.statusCode).toBe(400);
  });

  it('lançamento passado é efetivado, futuro é previsto, e o saldo esperado soma os de até hoje', async () => {
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 200_00,
      date: '2026-10-10',
      accountId: checking.id,
      categoryId: expenseCategory,
      description: 'Feira',
    });
    const future = await api.post('/transactions', {
      kind: 'INCOME',
      amountCents: 500_00,
      date: '2026-10-30',
      accountId: checking.id,
      description: 'Freela',
    });
    expect((future.json() as TransactionResponse[])[0].status).toBe('PLANNED');

    const account = await byId(checking.id);
    expect(account.balanceCents).toBe(800_00);
    expect(account.expectedBalanceCents).toBe(800_00);
  });

  it('transferência move entre contas', async () => {
    const savings: AccountResponse = (
      await api.post('/accounts', { name: 'Reserva', type: 'SAVINGS' })
    ).json();
    const bad = await api.post('/transactions', {
      kind: 'TRANSFER',
      amountCents: 100_00,
      date: '2026-10-18',
      accountId: checking.id,
      description: 'Guardar',
    });
    expect(bad.statusCode).toBe(400);
    await api.post('/transactions', {
      kind: 'TRANSFER',
      amountCents: 100_00,
      date: '2026-10-18',
      accountId: checking.id,
      toAccountId: savings.id,
      description: 'Guardar',
    });
    expect((await byId(checking.id)).balanceCents).toBe(900_00);
    expect((await byId(savings.id)).balanceCents).toBe(100_00);
  });

  it('compra parcelada no cartão cai em faturas seguidas e a fatura é paga', async () => {
    const created: TransactionResponse[] = (
      await api.post('/transactions', {
        kind: 'EXPENSE',
        amountCents: 300_00,
        date: '2026-10-20',
        accountId: card.id,
        categoryId: expenseCategory,
        description: 'Fone',
        installments: 3,
      })
    ).json();
    expect(created.map((t) => [t.date, t.amountCents, t.installmentNumber, t.status])).toEqual([
      ['2026-10-20', 100_00, 1, 'DONE'],
      ['2026-11-20', 100_00, 2, 'DONE'],
      ['2026-12-20', 100_00, 3, 'DONE'],
    ]);

    // Compra no dia do fechamento vai para a fatura seguinte.
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 50_00,
      date: '2026-10-25',
      accountId: card.id,
      description: 'Padaria',
    });

    const invoices: InvoiceResponse[] = (await api.get(`/accounts/${card.id}/invoices`)).json();
    expect(invoices.map((i) => [i.referenceMonth, i.totalCents, i.dueDate, i.status])).toEqual([
      ['2026-12', 100_00, '2027-01-05', 'OPEN'],
      ['2026-11', 150_00, '2026-12-05', 'OPEN'],
      ['2026-10', 100_00, '2026-11-05', 'OPEN'],
    ]);
    expect((await byId(card.id)).openInvoiceCents).toBe(100_00);

    const october = invoices[2];
    const paid = await api.post(`/invoices/${october.id}/pay`, {});
    expect(paid.json()).toMatchObject({ status: 'PAID' });
    expect((await api.post(`/invoices/${october.id}/pay`, {})).statusCode).toBe(409);
    expect((await byId(checking.id)).balanceCents).toBe(900_00);
    // Padaria (25/10) ainda é prevista: o saldo do cartão conta as 3 parcelas menos o pagamento.
    expect((await byId(card.id)).balanceCents).toBe(-200_00);

    // Apagar o pagamento reabre a fatura.
    const payment = paid.json().paymentTransactionId;
    expect((await api.delete(`/transactions/${payment}`)).statusCode).toBe(204);
    const reopened: InvoiceResponse[] = (await api.get(`/accounts/${card.id}/invoices`)).json();
    expect(reopened[2].status).toBe('OPEN');
  });

  it('recorrência gera 12 meses de previstos e edita/apaga daqui para frente', async () => {
    const created: TransactionResponse[] = (
      await api.post('/transactions', {
        kind: 'INCOME',
        amountCents: 5000_00,
        date: '2026-10-05',
        accountId: checking.id,
        description: 'Salário',
        recurrence: { rrule: 'FREQ=MONTHLY' },
      })
    ).json();
    expect(created).toHaveLength(13);
    expect(created[0]).toMatchObject({ status: 'DONE', recurrenceRule: 'FREQ=MONTHLY' });
    expect(created[1]).toMatchObject({ date: '2026-11-05', status: 'PLANNED' });

    // Aumento a partir de dezembro.
    const december = created[2];
    await api.patch(`/transactions/${december.id}`, { amountCents: 5500_00, scope: 'future' });
    const after: TransactionResponse[] = (await api.get('/transactions?kind=INCOME')).json();
    const amounts = Object.fromEntries(after.map((t) => [t.date, t.amountCents]));
    expect(amounts['2026-11-05']).toBe(5000_00);
    expect(amounts['2026-12-05']).toBe(5500_00);
    expect(amounts['2027-06-05']).toBe(5500_00);

    // Só esta: vira exceção e não muda com as próximas edições.
    const january = after.find((t) => t.date === '2027-01-05')!;
    await api.patch(`/transactions/${january.id}`, { amountCents: 6000_00 });
    await api.patch(`/transactions/${december.id}`, {
      description: 'Salário novo',
      scope: 'future',
    });
    const jan = await prisma.transaction.findUniqueOrThrow({ where: { id: january.id } });
    expect(jan).toMatchObject({
      amountCents: 6000_00,
      description: 'Salário',
      isRecurrenceException: true,
    });

    // Cancela a partir de março: some de março em diante e a extensão não recria.
    const march = after.find((t) => t.date === '2027-03-05')!;
    await api.delete(`/transactions/${march.id}?scope=future`);
    const remaining: TransactionResponse[] = (await api.get('/transactions?kind=INCOME')).json();
    expect(
      remaining
        .map((t) => t.date)
        .sort()
        .at(-1)
    ).toBe('2027-02-05');

    vi.setSystemTime(new Date('2027-08-01T12:00:00Z'));
    await extendRecurrences();
    expect(await prisma.transaction.count({ where: { kind: 'INCOME' } })).toBe(remaining.length);
  });

  it('a extensão diária cria os meses que faltam', async () => {
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 50_00,
      date: '2026-10-18',
      accountId: checking.id,
      description: 'Streaming',
      recurrence: { rrule: 'FREQ=MONTHLY' },
    });
    expect(await prisma.transaction.count()).toBe(13);
    vi.setSystemTime(new Date('2027-01-20T12:00:00Z'));
    expect(await extendRecurrences()).toBe(3);
    expect(await extendRecurrences()).toBe(0);
  });

  it('previsão avisa o primeiro dia negativo, contando a fatura do cartão', async () => {
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 900_00,
      date: '2026-10-20',
      accountId: card.id,
      description: 'Passagem',
    });
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 300_00,
      date: '2026-10-28',
      accountId: checking.id,
      description: 'Aluguel',
    });

    const forecast = (await api.get('/reports/forecast?days=30')).json();
    expect(forecast.start).toBe('2026-10-18');
    expect(forecast.days).toHaveLength(30);
    const day = (date: string) => forecast.days.find((d: { date: string }) => d.date === date);
    expect(day('2026-10-28').totalCents).toBe(700_00);
    expect(day('2026-11-05').byAccount[checking.id]).toBe(-200_00);
    expect(day('2026-11-05').byAccount[card.id]).toBe(0);
    expect(forecast.firstNegative).toEqual({
      date: '2026-11-05',
      accountId: checking.id,
      balanceCents: -200_00,
    });

    expect((await api.get('/reports/forecast?days=10')).statusCode).toBe(400);
  });

  it('orçamento por categoria com alerta, cópia do mês anterior e resumo do mês', async () => {
    await api.put('/budgets', {
      categoryId: expenseCategory,
      month: '2026-10',
      limitCents: 500_00,
    });
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 420_00,
      date: '2026-10-12',
      accountId: checking.id,
      categoryId: expenseCategory,
      description: 'Mercado',
    });
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 60_00,
      date: '2026-10-29',
      accountId: checking.id,
      categoryId: expenseCategory,
      description: 'Mercado',
    });

    const [budget] = (await api.get('/budgets?month=2026-10')).json();
    expect(budget).toMatchObject({ spentCents: 420_00, plannedCents: 60_00, level: 'warn' });

    const copied = (await api.post('/budgets/copy-previous', { month: '2026-11' })).json();
    expect(copied).toHaveLength(1);

    const summary = (await api.get('/reports/month?month=2026-10')).json();
    expect(summary).toMatchObject({
      expenseCents: 420_00,
      plannedExpenseCents: 60_00,
      expenseByCategory: [{ categoryId: expenseCategory, totalCents: 420_00 }],
      previous: { month: '2026-09' },
    });
  });

  it('conta com lançamentos não é apagada, só arquivada', async () => {
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 1_00,
      date: '2026-10-18',
      accountId: checking.id,
      description: 'Café',
    });
    expect((await api.delete(`/accounts/${checking.id}`)).statusCode).toBe(409);
    await api.patch(`/accounts/${checking.id}`, { archived: true });
    expect((await accounts()).some((a) => a.id === checking.id)).toBe(false);
    expect(
      ((await api.get('/accounts?archived=true')).json() as AccountResponse[]).some(
        (a) => a.id === checking.id
      )
    ).toBe(true);
  });
});
