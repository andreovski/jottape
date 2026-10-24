import { describe, expect, it } from 'vitest';

import { CATEGORY_ICONS } from '@/components/finance/category-icon';

import { iconPages } from './categories-page';

describe('páginas do seletor de ícones', () => {
  it('divide em páginas de 3 linhas de 6', () => {
    const pages = iconPages(CATEGORY_ICONS);
    expect(pages.every((p) => p.length <= 18)).toBe(true);
    expect(pages.flat()).toEqual(CATEGORY_ICONS);
  });

  it('deixa a última página com o que sobrar', () => {
    expect(iconPages([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
