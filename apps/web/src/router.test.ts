import { describe, expect, it } from 'vitest';

import { createAppRouter } from './router';

const sources = import.meta.glob<string>(['./routes/**/*.tsx', '!./**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('rotas', () => {
  // Um `from` que não é id de rota quebra a tela inteira com "Invariant failed".
  it('toda tela lê search e params de um id de rota que existe', () => {
    const ids = Object.values(sources).flatMap((source) =>
      [...source.matchAll(/use(?:Search|Params)\(\{ from: '([^']+)'/g)].map((match) => match[1])
    );
    expect(ids.length).toBeGreaterThan(0);
    const known = Object.keys(createAppRouter().routesById);
    for (const id of ids) expect(known).toContain(id);
  });
});
