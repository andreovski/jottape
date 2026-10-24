import { getOwner } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { ensureOwner } from '@/services/owner';

// Roda no preDeploy do Railway, depois das migrations.
async function main() {
  const owner = getOwner();
  if (!owner) {
    console.warn('[seed] OWNER_EMAIL não definido: nenhum usuário criado.');
    return;
  }
  const user = await ensureOwner(prisma, owner);
  console.log(`[seed] dono pronto: ${user.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
