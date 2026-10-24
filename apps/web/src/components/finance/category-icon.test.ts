import { Tag } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { CATEGORY_ICONS, categoryIconOf } from './category-icon';

describe('ícones de categoria', () => {
  it('não repete nomes nem ícones', () => {
    const names = CATEGORY_ICONS.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(CATEGORY_ICONS.map((i) => i.icon)).size).toBe(names.length);
  });

  it('fecha as linhas da grade de 6', () => {
    expect(CATEGORY_ICONS.length % 6).toBe(0);
  });

  it('continua reconhecendo os ícones das categorias padrão', () => {
    for (const name of ['briefcase', 'plus-circle', 'home', 'shopping-cart', 'utensils', 'car']) {
      expect(categoryIconOf(name)).not.toBe(Tag);
    }
    for (const name of ['heart-pulse', 'party-popper', 'repeat', 'graduation-cap']) {
      expect(categoryIconOf(name)).not.toBe(Tag);
    }
  });

  it('cai na etiqueta quando o nome é desconhecido', () => {
    expect(categoryIconOf('nao-existe')).toBe(Tag);
    expect(categoryIconOf(null)).toBe(Tag);
  });
});
