import type {
  BankAdminResponse,
  BankFeedbackBody,
  BankStage,
  UpdateBankUserBody,
} from '@jottape/schemas';
import type { Prisma } from '@prisma/client';

import { getOwner } from '@/lib/env';
import { AppError, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { isOwner } from '@/services/assistant';

import { bankStatus, toBankMovement } from '.';

// Beta de Bancos: só o dono e os convidados do painel usam; o dono vê quem chegou até onde, o que
// casou ou precisou de revisão, os erros e os relatos de "Algo veio errado".

const DAY_MS = 24 * 60 * 60 * 1000;
const FEEDBACK_LIMIT = 50;

/** O dono sempre; os outros só com `bankAccess` ligado no painel. */
export async function bankAllowed(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, bankAccess: true },
  });
  if (!user) return false;
  return user.bankAccess || user.email === getOwner()?.email;
}

export async function assertBankAllowed(userId: string) {
  if (!(await bankAllowed(userId)))
    throw new AppError(403, 'Bancos está em beta, só para convidados.');
}

async function assertAdmin(userId: string) {
  if (!(await isOwner(userId))) throw new AppError(403, 'Só o dono do app vê o painel.');
}

/** Quem pode sincronizar no job (o dono e os convidados). */
export async function allowedUserIds(userIds: string[]) {
  const owner = getOwner()?.email;
  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      OR: [{ bankAccess: true }, ...(owner ? [{ email: owner }] : [])],
    },
    select: { id: true },
  });
  return new Set(users.map((u) => u.id));
}

// ---------------------------------------------------------------- relatos

export async function createFeedback(userId: string, body: BankFeedbackBody) {
  const status = await bankStatus(userId);
  let movement = null;
  if (body.movementId) {
    const row = await prisma.bankMovement.findFirst({
      where: { id: body.movementId, userId },
      include: { bankAccount: { select: { accountId: true } } },
    });
    if (!row) throw notFound('Lançamento do banco');
    movement = toBankMovement(row);
  }
  // A foto do estado: bancos, contas e o lançamento. Nunca as chaves (o clientId fica de fora).
  const snapshot = {
    syncedAt: status.syncedAt,
    lastError: status.lastError,
    pendingCount: status.pendingCount,
    items: status.items.map(({ itemId: _itemId, ...item }) => item),
    movement,
  };
  await prisma.bankFeedback.create({
    data: { userId, note: body.note, snapshot: snapshot as Prisma.InputJsonValue },
  });
}

// ---------------------------------------------------------------- painel

function stageOf(input: {
  keys: boolean;
  banks: number;
  linked: number;
  accepted: number;
}): BankStage {
  if (input.accepted) return 'accepted';
  if (input.linked) return 'linked';
  if (input.banks) return 'bank';
  if (input.keys) return 'keys';
  return 'none';
}

export async function bankAdmin(userId: string): Promise<BankAdminResponse> {
  await assertAdmin(userId);
  const since = new Date(Date.now() - 30 * DAY_MS);
  const owner = getOwner()?.email;

  const [users, credentials, items, accounts, movements, everAccepted, feedback] =
    await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, email: true, bankAccess: true },
      }),
      prisma.pluggyCredential.findMany({
        select: { userId: true, syncedAt: true, lastError: true },
      }),
      prisma.pluggyItem.findMany({ select: { userId: true, name: true, lastError: true } }),
      prisma.bankAccount.findMany({ select: { userId: true, accountId: true } }),
      prisma.bankMovement.findMany({
        where: { createdAt: { gte: since } },
        select: { userId: true, status: true, edited: true, date: true, createdAt: true },
      }),
      prisma.bankMovement.groupBy({
        by: ['userId'],
        where: { status: 'IMPORTED' },
        _count: true,
      }),
      prisma.bankFeedback.findMany({
        orderBy: { createdAt: 'desc' },
        take: FEEDBACK_LIMIT,
        include: { user: { select: { name: true } } },
      }),
    ]);

  return {
    users: users.map((user) => {
      const credential = credentials.find((c) => c.userId === user.id);
      const ownItems = items.filter((i) => i.userId === user.id);
      const linked = accounts.filter((a) => a.userId === user.id && a.accountId).length;
      const own = movements.filter((m) => m.userId === user.id);
      const by = (status: string) => own.filter((m) => m.status === status).length;
      const lags = own.map((m) => Math.max(0, (m.createdAt.getTime() - m.date.getTime()) / DAY_MS));
      const errors = [
        ...(credential?.lastError ? [credential.lastError] : []),
        ...ownItems.filter((i) => i.lastError).map((i) => `${i.name}: ${i.lastError}`),
      ];
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        access: user.email === owner ? 'owner' : user.bankAccess ? 'app' : 'none',
        stage: stageOf({
          keys: Boolean(credential),
          banks: ownItems.length,
          linked,
          accepted: everAccepted.find((g) => g.userId === user.id)?._count ?? 0,
        }),
        banks: ownItems.length,
        linkedAccounts: linked,
        last30: {
          matched: by('MATCHED'),
          imported: by('IMPORTED'),
          ignored: by('IGNORED'),
          pending: by('PENDING'),
          edited: own.filter((m) => m.edited).length,
        },
        errors,
        syncedAt: credential?.syncedAt?.toISOString() ?? null,
        lagDays: lags.length
          ? Math.round((lags.reduce((s, l) => s + l, 0) / lags.length) * 10) / 10
          : null,
      };
    }),
    feedback: feedback.map((f) => ({
      id: f.id,
      userName: f.user.name,
      note: f.note,
      snapshot: f.snapshot,
      createdAt: f.createdAt.toISOString(),
      resolvedAt: f.resolvedAt?.toISOString() ?? null,
    })),
  };
}

export async function updateBankUser(adminId: string, id: string, body: UpdateBankUserBody) {
  await assertAdmin(adminId);
  const { count } = await prisma.user.updateMany({
    where: { id },
    data: { bankAccess: body.bankAccess },
  });
  if (!count) throw notFound('Pessoa');
  return bankAdmin(adminId);
}

export async function resolveBankFeedback(adminId: string, id: string) {
  await assertAdmin(adminId);
  const { count } = await prisma.bankFeedback.updateMany({
    where: { id },
    data: { resolvedAt: new Date() },
  });
  if (!count) throw notFound('Relato');
  return bankAdmin(adminId);
}
