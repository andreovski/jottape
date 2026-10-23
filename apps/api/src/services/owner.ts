import type { CategoryKind, CategorySystemKey, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const DEFAULT_CATEGORIES: {
  name: string;
  kind: 'INCOME' | 'EXPENSE';
  color: string;
  icon: string;
}[] = [
  { name: 'Salário', kind: 'INCOME', color: '#34c759', icon: 'briefcase' },
  { name: 'Outras receitas', kind: 'INCOME', color: '#00c7be', icon: 'plus-circle' },
  { name: 'Moradia', kind: 'EXPENSE', color: '#af52de', icon: 'home' },
  { name: 'Mercado', kind: 'EXPENSE', color: '#ff9500', icon: 'shopping-cart' },
  { name: 'Alimentação', kind: 'EXPENSE', color: '#ff3b30', icon: 'utensils' },
  { name: 'Transporte', kind: 'EXPENSE', color: '#007aff', icon: 'car' },
  { name: 'Saúde', kind: 'EXPENSE', color: '#ff2d55', icon: 'heart-pulse' },
  { name: 'Lazer', kind: 'EXPENSE', color: '#ffcc00', icon: 'party-popper' },
  { name: 'Assinaturas', kind: 'EXPENSE', color: '#5856d6', icon: 'repeat' },
  { name: 'Educação', kind: 'EXPENSE', color: '#32ade6', icon: 'graduation-cap' },
  { name: 'Outras despesas', kind: 'EXPENSE', color: '#8e8e93', icon: 'circle-ellipsis' },
];

/**
 * Categorias fixas do app: Transferência e as formas de pagamento, uma árvore em entradas e outra
 * em saídas (o Pix pode ir e vir). Não se apagam nem se renomeiam; o código acha pela `systemKey`.
 * A migração 20261023020000 criou para quem já existia, com os mesmos nomes e ícones.
 */
export const SYSTEM_CATEGORIES: {
  key: CategorySystemKey;
  name: string;
  icon: string;
  color?: string;
  parent?: CategorySystemKey;
}[] = [
  { key: 'TRANSFER', name: 'Transferência', icon: 'landmark', color: '#32ade6' },
  { key: 'TRANSFER_PIX', name: 'Pix', icon: 'zap', parent: 'TRANSFER' },
  { key: 'TRANSFER_DEBIT', name: 'Débito', icon: 'wallet', parent: 'TRANSFER' },
  { key: 'TRANSFER_CREDIT', name: 'Crédito', icon: 'credit-card', parent: 'TRANSFER' },
];

/** Cria as categorias fixas que faltam. Idempotente; nunca mexe nas que já existem. */
export async function ensureSystemCategories(
  prisma: Pick<PrismaClient, 'category'>,
  userId: string
) {
  const existing = await prisma.category.findMany({
    where: { userId, systemKey: { not: null } },
    select: { id: true, kind: true, systemKey: true },
  });
  for (const kind of ['INCOME', 'EXPENSE'] as CategoryKind[]) {
    const ids = new Map(existing.filter((c) => c.kind === kind).map((c) => [c.systemKey!, c.id]));
    for (const category of SYSTEM_CATEGORIES) {
      if (ids.has(category.key)) continue;
      const created = await prisma.category.create({
        data: {
          userId,
          kind,
          name: category.name,
          icon: category.icon,
          color: category.color ?? null,
          systemKey: category.key,
          parentId: category.parent ? (ids.get(category.parent) ?? null) : null,
        },
      });
      ids.set(category.key, created.id);
    }
  }
}

export const hashPassword = (password: string) => bcrypt.hash(password, 10);

/**
 * Garante o dono do app (o primeiro usuário; os outros entram pelo cadastro com convite). Idempotente: roda a cada deploy. A senha só é
 * gravada na criação, para não desfazer uma troca feita pelo app.
 */
export async function ensureOwner(
  prisma: PrismaClient,
  owner: { email: string; password: string | null; name: string }
) {
  let user = await prisma.user.findUnique({ where: { email: owner.email } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: owner.email,
        name: owner.name,
        passwordHash: owner.password ? await hashPassword(owner.password) : null,
      },
    });
  }

  await ensureUserDefaults(prisma, user.id);
  return user;
}

/**
 * Categorias padrão e a lista "Entrada", para quem ainda não tem (dono e usuário cadastrado). As
 * fixas valem para todos, mesmo quem já tem categorias.
 */
export async function ensureUserDefaults(
  prisma: Pick<PrismaClient, 'category' | 'taskList'>,
  userId: string
) {
  if ((await prisma.category.count({ where: { userId } })) === 0) {
    await prisma.category.createMany({
      data: DEFAULT_CATEGORIES.map((category) => ({ ...category, userId })),
    });
  }
  await ensureSystemCategories(prisma, userId);

  if (!(await prisma.taskList.findFirst({ where: { userId, isInbox: true } }))) {
    await prisma.taskList.create({ data: { userId, name: 'Entrada', isInbox: true } });
  }
}
