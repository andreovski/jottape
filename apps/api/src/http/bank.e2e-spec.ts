import type {
  AccountResponse,
  BankMovementResponse,
  BankAdminResponse,
  BankStatusResponse,
  InvoiceResponse,
  TransactionResponse,
} from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { syncAllBanks } from '@/services/bank';
import { classifyWithHaiku, scoreWithJev } from '@/services/bank/ai-model';
import { hashPassword } from '@/services/owner';
import { FakePluggy } from '@/test/fake-pluggy';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

vi.mock('@/services/bank/ai-model', () => ({ classifyWithHaiku: vi.fn(), scoreWithJev: vi.fn() }));

// 18/10/2026, meio-dia em São Paulo.
const NOW = new Date('2026-10-18T15:00:00Z');

describe('bancos (Meu Pluggy)', () => {
  let pluggy: FakePluggy;
  let api: ReturnType<typeof client>;
  let userId: string;
  let checking: AccountResponse;
  let groceries: string;

  const CHECKING_ID = '22222222-2222-4222-8222-222222222222';
  const CARD_ID = '33333333-3333-4333-8333-333333333333';

  beforeAll(() => app.ready());
  afterAll(() => app.close());
  afterEach(() => {
    pluggy.uninstall();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    vi.stubEnv('OWNER_EMAIL', 'andre@example.com');
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    vi.mocked(classifyWithHaiku).mockReset();
    vi.mocked(scoreWithJev).mockReset();
    await resetDatabase();
    pluggy = new FakePluggy().install();
    const session = await loginAsOwner(app);
    api = client(app, session.cookie);
    userId = session.user.id;
    checking = (
      await api.post('/accounts', { name: 'Minha conta', type: 'CHECKING', initialBalanceCents: 0 })
    ).json();
    groceries = (await prisma.category.findFirstOrThrow({ where: { userId, name: 'Mercado' } })).id;
  });

  const status = async () => (await api.get('/bank')).json() as BankStatusResponse;
  const pending = async () => (await api.get('/bank/movements')).json() as BankMovementResponse[];

  async function connect() {
    expect(
      (
        await api.put('/bank/credentials', {
          clientId: 'pluggy-client',
          clientSecret: 'pluggy-secret',
        })
      ).statusCode
    ).toBe(200);
    const added = await api.post('/bank/items', { itemId: pluggy.itemId });
    expect(added.statusCode).toBe(200);
    const body = added.json() as BankStatusResponse;
    const accountId = (externalName: string) =>
      body.items[0]!.accounts.find((a) => a.name === externalName)!.id;
    return { checkingBank: accountId('Conta Corrente'), cardBank: accountId('Cartão Platinum') };
  }

  it('o aviso de privacidade aparece até a pessoa ler, e fica lido', async () => {
    expect((await status()).noticeAcceptedAt).toBeNull();
    const accepted = (await api.post('/bank/notice')).json() as BankStatusResponse;
    expect(accepted.noticeAcceptedAt).not.toBeNull();
    expect((await status()).noticeAcceptedAt).toBe(accepted.noticeAcceptedAt);
  });

  it('recusa chaves erradas e guarda o secret cifrado', async () => {
    const wrong = await api.put('/bank/credentials', { clientId: 'x', clientSecret: 'y' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().message).toContain('não aceitou');

    await api.put('/bank/credentials', {
      clientId: 'pluggy-client',
      clientSecret: 'pluggy-secret',
    });
    const credential = await prisma.pluggyCredential.findUniqueOrThrow({ where: { userId } });
    expect(credential.clientSecretEncrypted).not.toContain('pluggy-secret');
    expect(await status()).toMatchObject({
      configured: true,
      clientId: 'pluggy-client',
      items: [],
    });
  });

  it('adiciona o banco com as contas e o saldo, e recusa item de fora da aplicação', async () => {
    await api.put('/bank/credentials', {
      clientId: 'pluggy-client',
      clientSecret: 'pluggy-secret',
    });
    const missing = await api.post('/bank/items', {
      itemId: '99999999-9999-4999-8999-999999999999',
    });
    expect(missing.statusCode).toBe(404);

    await connect();
    const [item] = (await status()).items;
    expect(item).toMatchObject({ name: 'Banco Teste', status: 'UPDATED', lastError: null });
    expect(item!.accounts.map((a) => [a.name, a.type, a.balanceCents, a.accountId])).toEqual([
      ['Conta Corrente', 'BANK', 1500_00, null],
      ['Cartão Platinum', 'CREDIT', 320_40, null],
    ]);

    const token = (await api.post('/bank/connect-token')).json();
    expect(token).toEqual({ accessToken: 'connect-1', connectorIds: [200] });
  });

  it('ligar a conta casa o que já foi lançado, confirma o previsto e põe o resto em revisão', async () => {
    const { checkingBank } = await connect();
    // Já lançado à mão (dois dias de diferença) e uma conta prevista que o banco confirmou.
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 89_90,
      date: '2026-10-12',
      accountId: checking.id,
      categoryId: groceries,
      description: 'Supermercado Bom Preço',
    });
    const [planned] = (
      await api.post('/transactions', {
        kind: 'EXPENSE',
        amountCents: 120_00,
        date: '2026-10-16',
        accountId: checking.id,
        description: 'Internet',
        status: 'PLANNED',
      })
    ).json() as TransactionResponse[];

    pluggy.add(CHECKING_ID, {
      id: 'b1',
      description: 'SUPERMERCADO BOM PRECO',
      amount: -89.9,
      date: '2026-10-10T03:00:00.000Z',
    });
    pluggy.add(CHECKING_ID, {
      id: 'b2',
      description: 'Internet Fibra',
      amount: -120,
      date: '2026-10-15T03:00:00.000Z',
    });
    pluggy.add(CHECKING_ID, {
      id: 'b3',
      description: 'Supermercado Bom Preço',
      amount: -45,
      date: '2026-10-14T03:00:00.000Z',
    });
    pluggy.add(CHECKING_ID, {
      id: 'b4',
      description: 'Salário',
      amount: 5000,
      type: 'CREDIT',
      date: '2026-10-05T03:00:00.000Z',
    });
    // Antes do "importar desde" e agendado: ficam de fora.
    pluggy.add(CHECKING_ID, {
      id: 'b5',
      description: 'Antigo',
      amount: -1,
      date: '2026-08-01T03:00:00.000Z',
    });
    pluggy.add(CHECKING_ID, {
      id: 'b6',
      description: 'Agendado',
      amount: -1,
      status: 'PENDING',
      date: '2026-10-25T03:00:00.000Z',
    });

    const linked = await api.patch(`/bank/accounts/${checkingBank}`, { accountId: checking.id });
    expect(linked.statusCode).toBe(200);
    const bankAccount = (linked.json() as BankStatusResponse).items[0]!.accounts[0]!;
    expect(bankAccount).toMatchObject({ accountId: checking.id, importFrom: '2026-09-18' });

    const movements = await prisma.bankMovement.findMany({ orderBy: { externalId: 'asc' } });
    expect(movements.map((m) => [m.externalId, m.status])).toEqual([
      ['b1', 'MATCHED'],
      ['b2', 'MATCHED'],
      ['b3', 'PENDING'],
      ['b4', 'PENDING'],
    ]);
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: planned!.id } })).status
    ).toBe('DONE');

    // A categoria do mercado vem do lançamento parecido; o salário não tem histórico.
    const review = await pending();
    expect(
      review.map((m) => [m.description, m.kind, m.amountCents, m.suggestedCategoryId])
    ).toEqual([
      ['Supermercado Bom Preço', 'EXPENSE', 45_00, groceries],
      ['Salário', 'INCOME', 5000_00, null],
    ]);
    expect((await status()).pendingCount).toBe(2);

    // Sincronizar de novo não duplica nada.
    await api.post('/bank/sync');
    expect(await prisma.bankMovement.count()).toBe(4);

    const accepted = await api.post(`/bank/movements/${review[0]!.id}/accept`, {});
    expect(accepted.json()).toMatchObject({ status: 'IMPORTED' });
    const imported = await prisma.transaction.findUniqueOrThrow({
      where: { id: accepted.json().transactionId },
    });
    expect(imported).toMatchObject({ amountCents: 45_00, categoryId: groceries, status: 'DONE' });

    expect((await api.post(`/bank/movements/${review[1]!.id}/ignore`)).statusCode).toBe(204);
    expect(await pending()).toEqual([]);
    // Tocar duas vezes não cria outro lançamento.
    expect((await api.post(`/bank/movements/${review[0]!.id}/accept`, {})).statusCode).toBe(404);
  });

  it('a categoria de um lançado vale para os parecidos que ainda esperam revisão', async () => {
    const { checkingBank } = await connect();
    const income = (await prisma.category.findFirstOrThrow({ where: { userId, kind: 'INCOME' } }))
      .id;
    for (const [id, day] of [
      ['r1', '06'],
      ['r2', '13'],
    ])
      pluggy.add(CHECKING_ID, {
        id,
        description: 'RENDIMENTO DA CONTA',
        amount: 1.23,
        type: 'CREDIT',
        date: `2026-10-${day}T03:00:00.000Z`,
      });
    await api.patch(`/bank/accounts/${checkingBank}`, { accountId: checking.id });

    // Sem histórico, chegam sem categoria.
    const [first, second] = await pending();
    expect([first!.suggestedCategoryId, second!.suggestedCategoryId]).toEqual([null, null]);

    // Lançar um deles com categoria ensina o outro, mesmo sem sincronizar de novo.
    await api.post(`/bank/movements/${first!.id}/accept`, {
      categoryId: income,
      description: 'Rendimento',
    });
    expect((await pending()).map((m) => [m.id, m.suggestedCategoryId])).toEqual([
      [second!.id, income],
    ]);
    const accepted = await api.post('/bank/movements/accept-all');
    expect(accepted.statusCode).toBe(200);
    const imported = await prisma.transaction.findMany({
      where: { userId, kind: 'INCOME' },
      select: { categoryId: true },
    });
    expect(imported.map((t) => t.categoryId)).toEqual([income, income]);
  });

  it('Pix entra com o nome de quem recebeu e o texto do banco fica nas notas', async () => {
    const { checkingBank } = await connect();
    const raw = 'Transferência enviada pelo Pix|JOSIANE CRISTINA|•••.123.456-••|NU PAGAMENTOS - IP';
    pluggy.add(CHECKING_ID, {
      id: 'p1',
      description: raw,
      amount: -50,
      date: '2026-10-05T03:00:00.000Z',
    });
    await api.patch(`/bank/accounts/${checkingBank}`, { accountId: checking.id });

    const [movement] = await pending();
    expect(movement).toMatchObject({ description: 'Josiane Cristina', bankDescription: raw });
    const accepted = await api.post(`/bank/movements/${movement!.id}/accept`, {});
    expect(
      await prisma.transaction.findUniqueOrThrow({ where: { id: accepted.json().transactionId } })
    ).toMatchObject({ description: 'Josiane Cristina', notes: raw });

    // Notas mexidas na revisão valem no lugar do texto do banco.
    pluggy.add(CHECKING_ID, {
      id: 'p2',
      description: raw,
      amount: -30,
      date: '2026-10-06T03:00:00.000Z',
    });
    await api.post('/bank/sync');
    const [second] = await pending();
    const edited = await api.post(`/bank/movements/${second!.id}/accept`, { notes: 'Faxina' });
    expect(
      await prisma.transaction.findUniqueOrThrow({ where: { id: edited.json().transactionId } })
    ).toMatchObject({ notes: 'Faxina' });
  });

  it('sem histórico, a IA sugere; sem a IA, a regra fixa; e o histórico vence os dois', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubEnv('JEV_API_KEY', 'test-key');
    const { checkingBank } = await connect();
    const transport = (
      await prisma.category.findFirstOrThrow({ where: { userId, name: 'Transporte' } })
    ).id;
    const pix = (
      await prisma.category.findFirstOrThrow({
        where: { userId, kind: 'EXPENSE', systemKey: 'TRANSFER_PIX' },
      })
    ).id;
    await api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents: 12_00,
      date: '2026-09-20',
      accountId: checking.id,
      categoryId: groceries,
      description: 'Padaria Pão Quente',
    });
    const raw = 'Transferência enviada pelo Pix|JOSIANE CRISTINA|•••.123.456-••|NU PAGAMENTOS - IP';
    pluggy.add(CHECKING_ID, {
      id: 'u1',
      description: 'UBER *TRIP',
      amount: -35,
      date: '2026-10-05T15:00:00.000Z',
    });
    pluggy.add(CHECKING_ID, {
      id: 'p1',
      description: raw,
      amount: -50,
      date: '2026-10-06T15:00:00.000Z',
    });
    pluggy.add(CHECKING_ID, {
      id: 'h1',
      description: 'PADARIA PAO QUENTE',
      amount: -9,
      date: '2026-10-07T15:00:00.000Z',
    });
    vi.mocked(classifyWithHaiku).mockImplementation(async (movements) => ({
      picks: movements.map((m) => (m.title.startsWith('UBER') ? transport : null)),
      inputTokens: 3000,
      outputTokens: 400,
    }));
    vi.mocked(scoreWithJev).mockImplementation(async (m) => ({
      probabilities: new Map([[transport, m.title.startsWith('UBER') ? 0.91 : 0.2]]),
      inputTokens: 300,
    }));
    await api.patch(`/bank/accounts/${checkingBank}`, { accountId: checking.id });

    // O que o histórico já sabe nem vai para a IA.
    expect(vi.mocked(classifyWithHaiku).mock.calls[0]![0].map((m) => m.title)).toEqual([
      'Josiane Cristina',
      'UBER *TRIP',
    ]);
    const byTitle = Object.fromEntries((await pending()).map((m) => [m.description, m]));
    expect(byTitle['UBER *TRIP']).toMatchObject({
      suggestedCategoryId: transport,
      suggestionSource: 'AI',
      suggestionConfidence: 0.91,
    });
    expect(byTitle['Josiane Cristina']).toMatchObject({
      suggestedCategoryId: pix,
      suggestionSource: 'RULE',
      suggestionConfidence: null,
    });
    expect(byTitle['PADARIA PAO QUENTE']).toMatchObject({
      suggestedCategoryId: groceries,
      suggestionSource: 'HISTORY',
    });
    const usage = await prisma.assistantUsage.findMany({
      where: { userId, kind: 'BANK_CATEGORY' },
    });
    expect(usage).toMatchObject([{ modelInputTokens: 3000, jevInputTokens: 600 }]);

    // Cada um passa pela IA uma vez só.
    await api.post('/bank/sync');
    expect(classifyWithHaiku).toHaveBeenCalledTimes(1);

    // Lançado com outra categoria, o Uber vira histórico e vence a IA no próximo.
    await api.post(`/bank/movements/${byTitle['UBER *TRIP']!.id}/accept`, {
      categoryId: groceries,
    });
    pluggy.add(CHECKING_ID, {
      id: 'u2',
      description: 'UBER *TRIP',
      amount: -20,
      date: '2026-10-08T15:00:00.000Z',
    });
    await api.post('/bank/sync');
    expect((await pending()).find((m) => m.description === 'UBER *TRIP')).toMatchObject({
      suggestedCategoryId: groceries,
      suggestionSource: 'HISTORY',
    });
  });

  it('sem o Jotta, a IA não é chamada', async () => {
    const { checkingBank } = await connect();
    pluggy.add(CHECKING_ID, {
      id: 'u1',
      description: 'UBER *TRIP',
      amount: -35,
      date: '2026-10-05T15:00:00.000Z',
    });
    await api.patch(`/bank/accounts/${checkingBank}`, { accountId: checking.id });
    expect(classifyWithHaiku).not.toHaveBeenCalled();
    expect((await pending())[0]).toMatchObject({
      suggestedCategoryId: null,
      suggestionSource: null,
    });
  });

  it('cartão novo: cria o cartão com fechamento e vencimento, ignora o pagamento e lança na fatura', async () => {
    const { checkingBank, cardBank } = await connect();
    await api.patch(`/bank/accounts/${checkingBank}`, { accountId: checking.id });

    pluggy.add(CARD_ID, {
      id: 'c1',
      description: 'Livraria',
      amount: 80,
      date: '2026-10-11T03:00:00.000Z',
    });
    pluggy.add(CARD_ID, {
      id: 'c2',
      description: 'Pagamento recebido',
      amount: -500,
      type: 'CREDIT',
      date: '2026-10-06T03:00:00.000Z',
    });
    pluggy.add(CARD_ID, {
      id: 'c3',
      description: 'Loja de Móveis',
      amount: 300,
      date: '2026-08-15T03:00:00.000Z',
      status: 'PENDING',
      creditCardMetadata: {
        installmentNumber: 3,
        totalInstallments: 10,
        purchaseDate: '2026-08-15T03:00:00.000Z',
      },
    });

    const linked = (await api.patch(`/bank/accounts/${cardBank}`, { create: true })).json();
    const cardAccountId = (linked as BankStatusResponse).items[0]!.accounts[1]!.accountId!;
    const card = await prisma.account.findUniqueOrThrow({ where: { id: cardAccountId } });
    expect(card).toMatchObject({
      name: 'Cartão Platinum',
      type: 'CREDIT_CARD',
      closingDay: 25,
      dueDay: 5,
      paymentAccountId: checking.id,
    });

    const review = await pending();
    expect(review.map((m) => [m.description, m.date, m.installmentNumber])).toEqual([
      ['Loja de Móveis', '2026-10-15', 3],
      ['Livraria', '2026-10-11', null],
    ]);
    expect(
      (await prisma.bankMovement.findFirstOrThrow({ where: { externalId: 'c2' } })).status
    ).toBe('IGNORED');

    expect((await api.post('/bank/movements/accept-all')).json()).toEqual({ imported: 2 });
    const invoices = (
      await api.get(`/accounts/${cardAccountId}/invoices`)
    ).json() as InvoiceResponse[];
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ referenceMonth: '2026-10', totalCents: 380_00 });
    const furniture = await prisma.transaction.findFirstOrThrow({
      where: { accountId: cardAccountId, amountCents: 300_00 },
    });
    expect(furniture.description).toBe('Loja de Móveis (3/10)');
  });

  describe('faturas do banco', () => {
    // O banco fecha no dia 28 (o cartão diz 25): a Farmácia do dia 27 é da fatura de setembro,
    // paga no dia 7. A parcela 2/3 vem datada pela fatura (novembro, mês do vencimento).
    const SEPTEMBER_BILL = {
      id: 'bill-set',
      dueDate: '2026-10-08T03:00:00.000Z',
      billClosingDate: '2026-09-28T03:00:00.000Z',
      totalAmount: 200,
      payments: [{ paymentDate: '2026-10-07T03:00:00.000Z', amount: 200 }],
    };

    function addMovements(withBill: boolean, withDebit = true) {
      pluggy.add(CARD_ID, {
        id: 'k1',
        description: 'Farmácia',
        amount: 200,
        date: '2026-09-27T03:00:00.000Z',
        creditCardMetadata: withBill ? { billId: 'bill-set' } : null,
      });
      pluggy.add(CARD_ID, {
        id: 'k2',
        description: 'Loja',
        amount: 60,
        date: '2026-11-04T03:00:00.000Z',
        status: 'PENDING',
        creditCardMetadata: { installmentNumber: 2, totalInstallments: 3 },
      });
      if (withDebit) addDebit();
    }

    function addDebit() {
      pluggy.add(CHECKING_ID, {
        id: 'p1',
        description: 'Pagamento de fatura',
        amount: -200,
        date: '2026-10-07T03:00:00.000Z',
      });
    }

    const payments = () => prisma.transaction.findMany({ where: { paysInvoiceId: { not: null } } });

    async function linkBoth() {
      const { checkingBank, cardBank } = await connect();
      await api.patch(`/bank/accounts/${checkingBank}`, { accountId: checking.id });
      const linked = (await api.patch(`/bank/accounts/${cardBank}`, { create: true })).json();
      return (linked as BankStatusResponse).items[0]!.accounts[1]!.accountId!;
    }

    const invoicesOf = async (cardId: string) =>
      ((await api.get(`/accounts/${cardId}/invoices`)).json() as InvoiceResponse[])
        .map((i) => [i.referenceMonth, i.totalCents, i.status, i.closingDate, i.dueDate])
        .sort();

    async function expectRepaired(cardId: string) {
      expect(await invoicesOf(cardId)).toEqual([
        ['2026-09', 200_00, 'PAID', '2026-09-28', '2026-10-08'],
        ['2026-10', 60_00, 'OPEN', '2026-10-25', '2026-11-05'],
      ]);
      const payment = await prisma.bankMovement.findFirstOrThrow({
        where: { externalId: 'p1' },
        include: { transaction: true },
      });
      expect(payment.transaction).toMatchObject({
        kind: 'TRANSFER',
        amountCents: 200_00,
        accountId: checking.id,
        toAccountId: cardId,
        categoryId: null,
      });
      expect(payment.transaction!.paysInvoiceId).not.toBeNull();
    }

    it('põe cada lançamento na fatura do banco e o débito da conta paga a fatura', async () => {
      pluggy.bills.set(CARD_ID, [SEPTEMBER_BILL]);
      addMovements(true);
      const cardId = await linkBoth();
      expect((await api.post('/bank/movements/accept-all')).json()).toEqual({ imported: 3 });
      await expectRepaired(cardId);
    });

    it('conserta o que já foi lançado quando a fatura do banco chega', async () => {
      addMovements(false);
      const cardId = await linkBoth();
      await api.post('/bank/movements/accept-all');
      // Sem a fatura do banco: a Farmácia caiu em outubro e o pagamento virou despesa.
      expect((await invoicesOf(cardId)).map((i) => [i[0], i[1], i[2]])).toEqual([
        ['2026-10', 260_00, 'OPEN'],
      ]);

      pluggy.transactions.get(CARD_ID)![0]!.creditCardMetadata = { billId: 'bill-set' };
      pluggy.bills.set(CARD_ID, [SEPTEMBER_BILL]);
      await syncAllBanks();
      await expectRepaired(cardId);
    });

    it('paga por uma conta fora do Jottape: fica paga sem tirar da conta ligada', async () => {
      pluggy.bills.set(CARD_ID, [SEPTEMBER_BILL]);
      addMovements(true, false);
      const cardId = await linkBoth();
      await api.post('/bank/movements/accept-all');
      await syncAllBanks();
      expect((await invoicesOf(cardId))[0]!.slice(0, 3)).toEqual(['2026-09', 200_00, 'PAID']);
      expect(await payments()).toEqual([]);

      // O débito aparece depois na conta ligada: vira o pagamento.
      addDebit();
      await syncAllBanks();
      await expectRepaired(cardId);
    });

    it('tira o pagamento que saiu de uma conta ligada sem o débito no banco', async () => {
      pluggy.bills.set(CARD_ID, [SEPTEMBER_BILL]);
      addMovements(true, false);
      const cardId = await linkBoth();
      await api.post('/bank/movements/accept-all');
      const september = (
        (await api.get(`/accounts/${cardId}/invoices`)).json() as InvoiceResponse[]
      ).find((i) => i.referenceMonth === '2026-09')!;
      await api.post(`/invoices/${september.id}/pay`, {
        fromAccountId: checking.id,
        date: '2026-10-07',
      });
      expect(await payments()).toHaveLength(1);

      await syncAllBanks();
      expect(await payments()).toEqual([]);
      expect((await invoicesOf(cardId))[0]!.slice(0, 3)).toEqual(['2026-09', 200_00, 'PAID']);
    });
  });

  it('conta nova: o saldo inicial faz o saldo bater com o banco depois da revisão', async () => {
    const { checkingBank } = await connect();
    pluggy.add(CHECKING_ID, {
      id: 'n1',
      description: 'Café',
      amount: -15,
      date: '2026-10-17T03:00:00.000Z',
    });
    pluggy.add(CHECKING_ID, {
      id: 'n2',
      description: 'Pix recebido',
      amount: 200,
      type: 'CREDIT',
      date: '2026-10-16T03:00:00.000Z',
    });

    const linked = (await api.patch(`/bank/accounts/${checkingBank}`, { create: true })).json();
    const accountId = (linked as BankStatusResponse).items[0]!.accounts[0]!.accountId!;
    await api.post('/bank/movements/accept-all');
    const account = ((await api.get('/accounts')).json() as AccountResponse[]).find(
      (a) => a.id === accountId
    )!;
    expect(account.balanceCents).toBe(1500_00);
  });

  it('o job sincroniza todos, chave revogada vira erro e remover as chaves mantém os lançamentos', async () => {
    const { checkingBank } = await connect();
    await api.patch(`/bank/accounts/${checkingBank}`, { accountId: checking.id });
    pluggy.add(CHECKING_ID, {
      id: 'j1',
      description: 'Farmácia',
      amount: -30,
      date: '2026-10-17T03:00:00.000Z',
    });

    await syncAllBanks();
    const [movement] = await pending();
    expect(movement).toMatchObject({ description: 'Farmácia' });
    await api.post(`/bank/movements/${movement!.id}/accept`, {});

    pluggy.clientSecret = 'trocado';
    const { forgetPluggyKey } = await import('@/services/bank/client');
    forgetPluggyKey(userId);
    await syncAllBanks();
    expect((await status()).lastError).toContain('não aceitou');

    expect((await api.delete('/bank/credentials')).statusCode).toBe(204);
    expect(await status()).toMatchObject({ configured: false, items: [], pendingCount: 0 });
    expect(await prisma.transaction.count({ where: { description: 'Farmácia' } })).toBe(1);
  });

  it('não liga cartão a conta nem a uma conta de outro usuário', async () => {
    const { checkingBank, cardBank } = await connect();
    expect(
      (await api.patch(`/bank/accounts/${cardBank}`, { accountId: checking.id })).statusCode
    ).toBe(400);
    await api.patch(`/bank/accounts/${checkingBank}`, { accountId: checking.id });

    const other = await prisma.user.create({ data: { name: 'Outra', email: 'outra@example.com' } });
    const otherAccount = await prisma.account.create({
      data: { userId: other.id, name: 'Dela', type: 'CHECKING' },
    });
    expect(
      (await api.patch(`/bank/accounts/${checkingBank}`, { accountId: otherAccount.id })).statusCode
    ).toBe(404);
  });

  describe('beta', () => {
    async function guest() {
      await prisma.user.create({
        data: {
          email: 'bia@example.com',
          name: 'Bia',
          timezone: 'America/Sao_Paulo',
          passwordHash: await hashPassword('senha-da-bia'),
        },
      });
      const login = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { email: 'bia@example.com', password: 'senha-da-bia' },
      });
      const cookie = login.cookies.find((c) => c.name === 'jottape_session')!;
      return client(app, `jottape_session=${cookie.value}`);
    }

    it('só convidados usam; o dono convida pelo painel e vê até onde cada um chegou', async () => {
      const bia = await guest();
      expect((await bia.get('/bank')).statusCode).toBe(403);
      expect((await bia.get('/bank/admin')).statusCode).toBe(403);

      const panel = (await api.get('/bank/admin')).json() as BankAdminResponse;
      const biaId = panel.users.find((u) => u.email === 'bia@example.com')!.id;
      expect(panel.users.map((u) => [u.name, u.access, u.stage])).toEqual([
        ['André', 'owner', 'none'],
        ['Bia', 'none', 'none'],
      ]);

      const invited = (
        await api.patch(`/bank/admin/users/${biaId}`, { bankAccess: true })
      ).json() as BankAdminResponse;
      expect(invited.users.find((u) => u.id === biaId)!.access).toBe('app');
      expect((await bia.get('/bank')).statusCode).toBe(200);

      // O dono chega a "conta ligada" e aceita um lançamento trocando o tipo.
      pluggy.add(CHECKING_ID, {
        id: 'b1',
        description: 'Padaria',
        amount: -12,
        date: '2026-10-16T03:00:00.000Z',
      });
      const { checkingBank } = await connect();
      await api.patch(`/bank/accounts/${checkingBank}`, { accountId: checking.id });
      const [first] = await pending();
      await api.post(`/bank/movements/${first!.id}/accept`, {
        kind: first!.kind === 'EXPENSE' ? 'INCOME' : 'EXPENSE',
      });
      const owner = ((await api.get('/bank/admin')).json() as BankAdminResponse).users[0]!;
      expect(owner).toMatchObject({ stage: 'accepted', banks: 1, linkedAccounts: 1 });
      expect(owner.last30).toMatchObject({ imported: 1, edited: 1 });

      // Tirar o convite fecha de novo.
      await api.patch(`/bank/admin/users/${biaId}`, { bankAccess: false });
      expect((await bia.get('/bank')).statusCode).toBe(403);
    });

    it('"Algo veio errado" guarda o relato com a foto do estado, sem as chaves', async () => {
      pluggy.add(CHECKING_ID, {
        id: 'b1',
        description: 'Padaria',
        amount: -12,
        date: '2026-10-16T03:00:00.000Z',
      });
      const { checkingBank } = await connect();
      await api.patch(`/bank/accounts/${checkingBank}`, { accountId: checking.id });
      const [first] = await pending();
      expect(
        (await api.post('/bank/feedback', { note: 'Veio duplicado', movementId: first!.id }))
          .statusCode
      ).toBe(204);

      const [report] = ((await api.get('/bank/admin')).json() as BankAdminResponse).feedback;
      expect(report).toMatchObject({ userName: 'André', note: 'Veio duplicado', resolvedAt: null });
      const snapshot = JSON.stringify(report!.snapshot);
      expect(snapshot).toContain(first!.description);
      expect(snapshot).not.toContain('pluggy-client');
      expect(snapshot).not.toContain(pluggy.itemId);

      const resolved = (
        await api.post(`/bank/admin/feedback/${report!.id}/resolve`)
      ).json() as BankAdminResponse;
      expect(resolved.feedback[0]!.resolvedAt).not.toBeNull();
    });
  });
});
