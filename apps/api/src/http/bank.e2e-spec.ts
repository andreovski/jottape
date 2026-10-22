import type {
  AccountResponse,
  BankMovementResponse,
  BankStatusResponse,
  InvoiceResponse,
  TransactionResponse,
} from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { syncAllBanks } from '@/services/bank';
import { FakePluggy } from '@/test/fake-pluggy';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

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
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
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
});
