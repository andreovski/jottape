import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import { TEST_DATABASE_URL } from './src/test/test-database-url';

// zod tem builds ESM e CJS separados. `@jottape/schemas` sai compilado em CJS e pede 'zod' pela
// condição "require", enquanto o `import { ZodError } from 'zod'` da API resolve pela "import" no
// Vitest: duas classes diferentes, e o `instanceof ZodError` do handler de erro falha. Os dois
// lados vão para o mesmo arquivo (CJS), como na Arttevo.
const zodRequirePath = createRequire(import.meta.url).resolve('zod');

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      zod: zodRequirePath,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.e2e-spec.ts'],
    globalSetup: ['./src/test/e2e-global-setup.ts'],
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: 'test',
    },
  },
});
