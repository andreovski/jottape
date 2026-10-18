import { execSync } from 'node:child_process';

import { TEST_DATABASE_URL } from './test-database-url';

export default function setup() {
  const databaseName = new URL(TEST_DATABASE_URL).pathname.replace('/', '');

  if (!databaseName.endsWith('_test')) {
    throw new Error(`Refusing to reset a database that is not a test database: ${databaseName}`);
  }

  execSync('pnpm exec prisma migrate reset --force --skip-seed --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
