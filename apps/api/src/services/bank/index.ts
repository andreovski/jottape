import { addDays } from '@jottape/finance-engine';
import type {
  AcceptBankMovementBody,
  BankMovementResponse,
  BankStatusResponse,
  LinkBankAccountBody,
  SaveBankCredentialsBody,
} from '@jottape/schemas';
import type { AccountType, BankAccount, BankMovement, Prisma } from '@prisma/client';

import { encrypt } from '@/lib/crypto';
import { fromDbDate, todayIn, toDbDate } from '@/lib/dates';
import { AppError, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { createTransactions, userTimezone } from '@/services/finance';

import {
  authenticatePluggy,
  createConnectToken,
  fetchAccounts,
  fetchItem,
  fetchTransactions,
  forgetPluggyKey,
  meuPluggyConnectorIds,
  type PluggyAccount,
  PluggyApiError,
  pluggyFetch,
  type PluggyItem,
} from './client';
import {
  candidateRange,
  categoryMemory,
  findMatch,
  importedDescription,
  parseMovement,
  suggestCategory,
} from './movements';

// Bancos pelo Meu Pluggy. Cada sincronização lê as contas dos bancos conectados e, nas ligadas a
// uma conta do Jottape, os lançamentos novos: o que já foi lançado à mão (mesmo valor, data perto)
// só é marcado como visto; o resto espera revisão em "A revisar" antes de entrar no saldo.

/** Na primeira ligação, quantos dias para trás importar. */
export const DEFAULT_IMPORT_DAYS = 30;
/** Nas sincronizações seguintes, a janela que é relida (o banco lança com atraso). */
const RESYNC_DAYS = 40;

const UNAVAILABLE = 'A Pluggy não respondeu. Tente de novo em instantes.';

/** Erro da Pluggy numa ação do usuário vira mensagem; chave inválida já vem como AppError. */
async function friendly<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PluggyApiError) throw new AppError(502, UNAVAILABLE);
    throw error;
  }
}

function errorText(error: unknown): string {
  return error instanceof AppError ? error.message : UNAVAILABLE;
}

const ITEM_ERRORS: Record<string, string> = {
  LOGIN_ERROR: 'O banco recusou o acesso. Conecte de novo no Meu Pluggy.',
  OUTDATED: 'A conexão com o banco está desatualizada. Abra o Meu Pluggy e reconecte o banco.',
  WAITING_USER_INPUT: 'O banco está esperando uma confirmação no Meu Pluggy.',
};

function itemError(item: PluggyItem): string | null {
  return ITEM_ERRORS[item.status] ?? (item.error?.message || null);
}

// ---------------------------------------------------------------- estado

export async function bankStatus(userId: string): Promise<BankStatusResponse> {
  const [credential, items, pendingCount] = await Promise.all([
    prisma.pluggyCredential.findUnique({ where: { userId } }),
    prisma.pluggyItem.findMany({
      where: { userId },
      include: { accounts: { orderBy: [{ type: 'asc' }, { name: 'asc' }] } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.bankMovement.count({
      where: { userId, status: 'PENDING', bankAccount: { accountId: { not: null } } },
    }),
  ]);
  return {
    configured: Boolean(credential),
    clientId: credential?.clientId ?? null,
    syncedAt: credential?.syncedAt?.toISOString() ?? null,
    lastError: credential?.lastError ?? null,
    pendingCount,
    items: items.map((item) => ({
      id: item.id,
      itemId: item.itemId,
      name: item.name,
      imageUrl: item.imageUrl,
      status: item.status,
      lastError: item.lastError,
      syncedAt: item.syncedAt?.toISOString() ?? null,
      accounts: item.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        number: account.number,
        type: account.type,
        balanceCents: account.balanceCents,
        accountId: account.accountId,
        importFrom: account.importFrom ? fromDbDate(account.importFrom) : null,
        syncedAt: account.syncedAt?.toISOString() ?? null,
      })),
    })),
  };
}

// ---------------------------------------------------------------- chaves e bancos

export async function saveCredentials(userId: string, body: SaveBankCredentialsBody) {
  await friendly(() => authenticatePluggy(body.clientId, body.clientSecret));
  const data = {
    clientId: body.clientId,
    clientSecretEncrypted: encrypt(body.clientSecret),
    lastError: null,
  };
  await prisma.pluggyCredential.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
  forgetPluggyKey(userId);
  return bankStatus(userId);
}

/** Apaga as chaves e os bancos. Os lançamentos já importados continuam no Jottape. */
export async function removeCredentials(userId: string) {
  await prisma.$transaction([
    prisma.pluggyItem.deleteMany({ where: { userId } }),
    prisma.pluggyCredential.deleteMany({ where: { userId } }),
  ]);
  forgetPluggyKey(userId);
}

export async function connectToken(userId: string) {
  return friendly(async () => ({
    accessToken: await createConnectToken(userId),
    connectorIds: await meuPluggyConnectorIds(userId),
  }));
}

export async function addItem(userId: string, itemId: string) {
  let remote: PluggyItem;
  try {
    remote = await fetchItem(userId, itemId);
  } catch (error) {
    if (error instanceof PluggyApiError && (error.status === 404 || error.status === 400)) {
      throw new AppError(404, 'Esse banco não está na sua aplicação da Pluggy.');
    }
    throw error instanceof PluggyApiError ? new AppError(502, UNAVAILABLE) : error;
  }
  const item = await prisma.pluggyItem.upsert({
    where: { userId_itemId: { userId, itemId } },
    update: {},
    create: { userId, itemId, name: remote.connector?.name ?? 'Banco' },
  });
  await friendly(() => syncItem(userId, item.id, { remote }));
  return bankStatus(userId);
}

export async function removeItem(userId: string, id: string) {
  const { count } = await prisma.pluggyItem.deleteMany({ where: { id, userId } });
  if (!count) throw notFound('Banco');
}

// ---------------------------------------------------------------- ligar contas

const COMPATIBLE: Record<BankAccount['type'], AccountType[]> = {
  BANK: ['CHECKING', 'SAVINGS', 'WALLET'],
  CREDIT: ['CREDIT_CARD'],
};

function dayOf(iso: string | null | undefined, timeZone: string): number | null {
  if (!iso) return null;
  return Number(todayIn(timeZone, new Date(iso)).slice(8, 10));
}

async function createAccountFor(
  userId: string,
  bankAccount: BankAccount,
  timeZone: string
): Promise<string> {
  const remote = await pluggyFetch<PluggyAccount>(userId, `/accounts/${bankAccount.externalId}`);
  if (bankAccount.type === 'BANK') {
    const account = await prisma.account.create({
      data: {
        userId,
        name: bankAccount.name,
        type: remote.subtype === 'SAVINGS_ACCOUNT' ? 'SAVINGS' : 'CHECKING',
      },
    });
    return account.id;
  }
  // A fatura é paga pela conta do mesmo banco, se ela já estiver ligada.
  const payer = await prisma.bankAccount.findFirst({
    where: { userId, itemId: bankAccount.itemId, type: 'BANK', accountId: { not: null } },
  });
  const account = await prisma.account.create({
    data: {
      userId,
      name: bankAccount.name,
      type: 'CREDIT_CARD',
      closingDay: dayOf(remote.creditData?.balanceCloseDate, timeZone) ?? 1,
      dueDay: dayOf(remote.creditData?.balanceDueDate, timeZone) ?? 10,
      paymentAccountId: payer?.accountId ?? null,
    },
  });
  return account.id;
}

export async function linkAccount(userId: string, id: string, body: LinkBankAccountBody) {
  const bankAccount = await prisma.bankAccount.findFirst({ where: { id, userId } });
  if (!bankAccount) throw notFound('Conta do banco');
  const timeZone = await userTimezone(userId);
  const today = todayIn(timeZone);

  // O que esperava revisão era para a conta antiga.
  await prisma.bankMovement.deleteMany({ where: { bankAccountId: id, status: 'PENDING' } });

  if (!body.create && !body.accountId) {
    await prisma.bankAccount.update({
      where: { id },
      data: { accountId: null, importFrom: null, syncedAt: null },
    });
    return bankStatus(userId);
  }

  let accountId: string;
  if (body.create) {
    accountId = await friendly(() => createAccountFor(userId, bankAccount, timeZone));
  } else {
    const account = await prisma.account.findFirst({
      where: { id: body.accountId!, userId, archivedAt: null },
      include: { bankAccount: { select: { id: true } } },
    });
    if (!account) throw notFound('Conta');
    if (!COMPATIBLE[bankAccount.type].includes(account.type)) {
      throw new AppError(
        400,
        bankAccount.type === 'CREDIT'
          ? 'Um cartão do banco só pode ser ligado a um cartão do Jottape.'
          : 'Uma conta do banco não pode ser ligada a um cartão do Jottape.'
      );
    }
    if (account.bankAccount && account.bankAccount.id !== id) {
      throw new AppError(409, 'Essa conta do Jottape já está ligada a outra conta do banco.');
    }
    accountId = account.id;
  }

  const importFrom = body.importFrom ?? addDays(today, -DEFAULT_IMPORT_DAYS);
  const linked = await prisma.bankAccount.update({
    where: { id },
    data: { accountId, importFrom: toDbDate(importFrom), syncedAt: null },
  });

  try {
    await importMovements(userId, linked, timeZone, await historyMemory(userId));
  } catch (error) {
    await prisma.pluggyItem.update({
      where: { id: bankAccount.itemId },
      data: { lastError: errorText(error) },
    });
  }

  // Conta nova: o saldo inicial é o do banco menos o que entra pela importação, para que, com
  // tudo revisado, o saldo do Jottape bata com o do banco.
  if (body.create && bankAccount.type === 'BANK') {
    const movements = await prisma.bankMovement.findMany({ where: { bankAccountId: id } });
    const net = movements.reduce(
      (sum, m) => sum + (m.kind === 'INCOME' ? m.amountCents : -m.amountCents),
      0
    );
    await prisma.account.update({
      where: { id: accountId },
      data: { initialBalanceCents: bankAccount.balanceCents - net },
    });
  }
  return bankStatus(userId);
}

// ---------------------------------------------------------------- sincronização

/** Categoria do lançamento mais recente com a mesma descrição, para sugerir na revisão. */
async function historyMemory(userId: string) {
  const history = await prisma.transaction.findMany({
    where: { userId, categoryId: { not: null } },
    select: { description: true, kind: true, categoryId: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 3000,
  });
  return categoryMemory(history);
}

/** Lê os lançamentos novos de uma conta ligada e casa ou põe em revisão. */
async function importMovements(
  userId: string,
  bankAccount: BankAccount,
  timeZone: string,
  memory: Map<string, string>
) {
  if (!bankAccount.accountId) return 0;
  const accountId = bankAccount.accountId;
  const today = todayIn(timeZone);
  const importFrom = bankAccount.importFrom ? fromDbDate(bankAccount.importFrom) : today;
  const recent = addDays(today, -RESYNC_DAYS);
  const dateFrom = bankAccount.syncedAt && recent > importFrom ? recent : importFrom;

  // No cartão, parcelas de compras antigas podem vir datadas pela compra: lemos um ano antes e
  // filtramos pela data da parcela.
  const fetchFrom = bankAccount.type === 'CREDIT' ? addDays(dateFrom, -366) : dateFrom;
  const remote = await fetchTransactions(userId, bankAccount.externalId, fetchFrom);
  const known = new Set(
    (
      await prisma.bankMovement.findMany({
        where: { bankAccountId: bankAccount.id, externalId: { in: remote.map((tx) => tx.id) } },
        select: { externalId: true },
      })
    ).map((m) => m.externalId)
  );
  const fresh = remote
    .filter((tx) => !known.has(tx.id))
    .map((tx) => parseMovement(tx, bankAccount.type, timeZone))
    .filter((m): m is NonNullable<typeof m> => m !== null && m.date >= dateFrom)
    .sort((a, b) => a.date.localeCompare(b.date));

  const range = candidateRange(fresh);
  const candidates = range
    ? await prisma.transaction.findMany({
        where: {
          userId,
          OR: [{ accountId }, { toAccountId: accountId }],
          date: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
        },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const taken = new Set(
    (
      await prisma.bankMovement.findMany({
        where: { bankAccountId: bankAccount.id, transactionId: { not: null } },
        select: { transactionId: true },
      })
    ).map((m) => m.transactionId!)
  );
  const options = candidates.map((tx) => ({ ...tx, date: fromDbDate(tx.date) }));

  const rows: Prisma.BankMovementCreateManyInput[] = [];
  const confirm: string[] = [];
  for (const movement of fresh) {
    const base = {
      userId,
      bankAccountId: bankAccount.id,
      externalId: movement.externalId,
      kind: movement.kind,
      amountCents: movement.amountCents,
      date: toDbDate(movement.date),
      description: movement.description,
      installmentNumber: movement.installmentNumber,
      installmentTotal: movement.installmentTotal,
    };
    const match = findMatch(movement, accountId, options, taken);
    if (match) {
      taken.add(match.id);
      if (candidates.find((tx) => tx.id === match.id)?.status === 'PLANNED') confirm.push(match.id);
      rows.push({ ...base, status: 'MATCHED', transactionId: match.id });
    } else if (movement.isCardPayment) {
      rows.push({ ...base, status: 'IGNORED' });
    } else {
      rows.push({
        ...base,
        status: 'PENDING',
        suggestedCategoryId: suggestCategory(memory, movement),
      });
    }
  }

  await prisma.$transaction([
    // Duas sincronizações ao mesmo tempo (job e botão) não duplicam: a chave única segura.
    prisma.bankMovement.createMany({ data: rows, skipDuplicates: true }),
    // O previsto que o banco confirmou vira efetivado.
    prisma.transaction.updateMany({
      where: { id: { in: confirm }, userId },
      data: { status: 'DONE' },
    }),
    prisma.bankAccount.update({ where: { id: bankAccount.id }, data: { syncedAt: new Date() } }),
  ]);
  return rows.length;
}

/** Atualiza um banco: estado, contas e saldos, e os lançamentos das contas ligadas. */
async function syncItem(
  userId: string,
  id: string,
  context: { remote?: PluggyItem; timeZone?: string; memory?: Map<string, string> } = {}
) {
  const item = await prisma.pluggyItem.findUniqueOrThrow({ where: { id } });
  const remote = context.remote ?? (await fetchItem(userId, item.itemId));
  const accounts = await fetchAccounts(userId, item.itemId);

  for (const account of accounts) {
    const data = {
      name: (account.marketingName || account.name).slice(0, 120),
      number: account.number ?? null,
      type: account.type,
      balanceCents: Math.round(account.balance * 100),
    };
    await prisma.bankAccount.upsert({
      where: { userId_externalId: { userId, externalId: account.id } },
      update: data,
      create: { userId, itemId: item.id, externalId: account.id, ...data },
    });
  }

  const linked = await prisma.bankAccount.findMany({
    where: { itemId: item.id, accountId: { not: null } },
  });
  if (linked.length) {
    const timeZone = context.timeZone ?? (await userTimezone(userId));
    const memory = context.memory ?? (await historyMemory(userId));
    for (const bankAccount of linked) await importMovements(userId, bankAccount, timeZone, memory);
  }

  await prisma.pluggyItem.update({
    where: { id },
    data: {
      name: remote.connector?.name ?? item.name,
      imageUrl: remote.connector?.imageUrl ?? item.imageUrl,
      status: remote.status,
      lastError: itemError(remote),
      syncedAt: new Date(),
    },
  });
}

/** Sincroniza todos os bancos do usuário. Erros ficam gravados (chaves e banco), não sobem. */
export async function syncUser(userId: string) {
  const credential = await prisma.pluggyCredential.findUnique({ where: { userId } });
  if (!credential) return;
  const items = await prisma.pluggyItem.findMany({ where: { userId } });
  const timeZone = await userTimezone(userId);
  const memory = await historyMemory(userId);
  let lastError: string | null = null;

  for (const item of items) {
    try {
      await syncItem(userId, item.id, { timeZone, memory });
    } catch (error) {
      if (!(error instanceof AppError || error instanceof PluggyApiError)) throw error;
      lastError = errorText(error);
      // Chave inválida vale para todos os bancos: não adianta tentar os outros.
      if (error instanceof AppError) break;
      await prisma.pluggyItem.update({ where: { id: item.id }, data: { lastError } });
      lastError = null;
    }
  }
  await prisma.pluggyCredential.update({
    where: { userId },
    data: { syncedAt: new Date(), lastError },
  });
}

/** Job: o Meu Pluggy atualiza os bancos uma vez por dia; aqui passamos a cada poucas horas. */
export async function syncAllBanks() {
  const credentials = await prisma.pluggyCredential.findMany({ select: { userId: true } });
  for (const { userId } of credentials) {
    try {
      await syncUser(userId);
    } catch (error) {
      console.error('[bank]', userId, error);
    }
  }
}

// ---------------------------------------------------------------- revisão

type MovementWithAccount = BankMovement & { bankAccount: Pick<BankAccount, 'accountId'> };

export function toBankMovement(movement: MovementWithAccount): BankMovementResponse {
  return {
    id: movement.id,
    bankAccountId: movement.bankAccountId,
    accountId: movement.bankAccount.accountId,
    kind: movement.kind === 'INCOME' ? 'INCOME' : 'EXPENSE',
    amountCents: movement.amountCents,
    date: fromDbDate(movement.date),
    description: movement.description,
    installmentNumber: movement.installmentNumber,
    installmentTotal: movement.installmentTotal,
    status: movement.status,
    suggestedCategoryId: movement.suggestedCategoryId,
    transactionId: movement.transactionId,
  };
}

const withAccount = { bankAccount: { select: { accountId: true } } } as const;

export async function listMovements(userId: string, status: BankMovement['status']) {
  const movements = await prisma.bankMovement.findMany({
    where: {
      userId,
      status,
      ...(status === 'PENDING' ? { bankAccount: { accountId: { not: null } } } : {}),
    },
    include: withAccount,
    orderBy: [{ date: 'desc' }, { createdAt: 'asc' }],
    take: 500,
  });
  return movements.map(toBankMovement);
}

export async function acceptMovement(
  userId: string,
  id: string,
  body: AcceptBankMovementBody = {}
) {
  const movement = await prisma.bankMovement.findFirst({
    where: { id, userId, status: 'PENDING' },
    include: withAccount,
  });
  if (!movement) throw notFound('Lançamento do banco');
  const accountId = movement.bankAccount.accountId;
  if (!accountId) throw new AppError(400, 'Ligue a conta do banco a uma conta do Jottape.');

  // Trava contra dois toques: só quem muda de PENDING para IMPORTED cria o lançamento.
  const { count } = await prisma.bankMovement.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'IMPORTED' },
  });
  if (!count) throw notFound('Lançamento do banco');

  const kind = body.kind ?? (movement.kind === 'INCOME' ? 'INCOME' : 'EXPENSE');
  const categoryId =
    body.categoryId !== undefined
      ? body.categoryId
      : kind === movement.kind
        ? movement.suggestedCategoryId
        : null;
  try {
    const [created] = await createTransactions(userId, {
      kind,
      amountCents: movement.amountCents,
      date: fromDbDate(movement.date),
      accountId,
      categoryId,
      description: body.description ?? importedDescription(movement),
      status: 'DONE',
    });
    const updated = await prisma.bankMovement.update({
      where: { id },
      data: { transactionId: created!.id },
      include: withAccount,
    });
    return toBankMovement(updated);
  } catch (error) {
    await prisma.bankMovement.update({ where: { id }, data: { status: 'PENDING' } });
    throw error;
  }
}

/** Aceita todos os pendentes com a categoria sugerida. */
export async function acceptAll(userId: string) {
  const pending = await listMovements(userId, 'PENDING');
  let imported = 0;
  for (const movement of pending) {
    try {
      await acceptMovement(userId, movement.id);
      imported++;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }
  return { imported };
}

export async function ignoreMovement(userId: string, id: string) {
  const { count } = await prisma.bankMovement.updateMany({
    where: { id, userId, status: 'PENDING' },
    data: { status: 'IGNORED' },
  });
  if (!count) throw notFound('Lançamento do banco');
}
