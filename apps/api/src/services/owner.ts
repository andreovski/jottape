import type { PrismaClient } from '@prisma/client';
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

/** Categorias padrão e a lista "Entrada", para quem ainda não tem (dono e usuário cadastrado). */
export async function ensureUserDefaults(
  prisma: Pick<PrismaClient, 'category' | 'taskList'>,
  userId: string
) {
  if ((await prisma.category.count({ where: { userId } })) === 0) {
    await prisma.category.createMany({
      data: DEFAULT_CATEGORIES.map((category) => ({ ...category, userId })),
    });
  }

  if (!(await prisma.taskList.findFirst({ where: { userId, isInbox: true } }))) {
    await prisma.taskList.create({ data: { userId, name: 'Entrada', isInbox: true } });
  }
}
