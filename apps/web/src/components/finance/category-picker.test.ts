import type { CategoryResponse } from '@jottape/schemas';
import { describe, expect, it } from 'vitest';

import { sections } from './category-picker';

const cat = (id: string): CategoryResponse => ({
  id,
  name: id,
  kind: 'EXPENSE',
  parentId: null,
  icon: null,
  color: null,
});

describe('seletor de categoria', () => {
  it('junta as mães sem filhas e separa as que têm subcategorias', () => {
    const groups = [
      { parent: cat('a'), children: [] },
      { parent: cat('b'), children: [] },
      { parent: cat('c'), children: [cat('c1')] },
      { parent: cat('d'), children: [] },
    ];
    expect(sections(groups).map((s) => s.map((g) => g.parent.id))).toEqual([
      ['a', 'b'],
      ['c'],
      ['d'],
    ]);
  });
});
