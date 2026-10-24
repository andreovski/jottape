import { describe, expect, it } from 'vitest';

import { layoutColumns } from './layout';

const byId = (items: ReturnType<typeof layoutColumns>) =>
  Object.fromEntries(items.map((item) => [item.id, item]));

describe('layoutColumns', () => {
  it('evento sozinho ocupa a largura toda', () => {
    expect(layoutColumns([{ id: 'a', start: 60, end: 120 }])).toEqual([
      { id: 'a', start: 60, end: 120, column: 0, columns: 1, span: 1 },
    ]);
  });

  it('eventos encostados não se sobrepõem', () => {
    const placed = byId(
      layoutColumns([
        { id: 'a', start: 60, end: 120 },
        { id: 'b', start: 120, end: 180 },
      ])
    );
    expect(placed.a).toMatchObject({ column: 0, columns: 1 });
    expect(placed.b).toMatchObject({ column: 0, columns: 1 });
  });

  it('dois que se sobrepõem ficam lado a lado', () => {
    const placed = byId(
      layoutColumns([
        { id: 'b', start: 90, end: 150 },
        { id: 'a', start: 60, end: 120 },
      ])
    );
    expect(placed.a).toMatchObject({ column: 0, columns: 2, span: 1 });
    expect(placed.b).toMatchObject({ column: 1, columns: 2, span: 1 });
  });

  it('reaproveita a coluna livre e estica para a direita quando dá', () => {
    // a: 9–12 (longo), b: 9–10, c: 10–11, d: 11:30–12
    const placed = byId(
      layoutColumns([
        { id: 'a', start: 540, end: 720 },
        { id: 'b', start: 540, end: 600 },
        { id: 'c', start: 600, end: 660 },
        { id: 'd', start: 690, end: 720 },
      ])
    );
    expect(placed.a).toMatchObject({ column: 0, columns: 2 });
    expect(placed.b).toMatchObject({ column: 1, columns: 2 });
    expect(placed.c).toMatchObject({ column: 1, columns: 2 });
    expect(placed.d).toMatchObject({ column: 1, columns: 2 });
  });

  it('três ao mesmo tempo dividem em três; o vizinho livre deixa esticar', () => {
    const placed = byId(
      layoutColumns([
        { id: 'a', start: 0, end: 120 },
        { id: 'b', start: 0, end: 60 },
        { id: 'c', start: 0, end: 30 },
        { id: 'd', start: 60, end: 120 },
      ])
    );
    expect(placed.a).toMatchObject({ column: 0, columns: 3, span: 1 });
    expect(placed.b).toMatchObject({ column: 1, columns: 3, span: 1 });
    expect(placed.c).toMatchObject({ column: 2, columns: 3, span: 1 });
    // d entra na coluna 1 (b acabou) e a coluna 2 está livre depois das 0:30.
    expect(placed.d).toMatchObject({ column: 1, columns: 3, span: 2 });
  });

  it('grupos separados no mesmo dia não dividem a largura', () => {
    const placed = byId(
      layoutColumns([
        { id: 'a', start: 60, end: 120 },
        { id: 'b', start: 60, end: 120 },
        { id: 'c', start: 600, end: 660 },
      ])
    );
    expect(placed.a.columns).toBe(2);
    expect(placed.c).toMatchObject({ column: 0, columns: 1 });
  });

  it('evento curtíssimo conta com a altura mínima para a sobreposição', () => {
    const placed = byId(
      layoutColumns(
        [
          { id: 'a', start: 60, end: 65 },
          { id: 'b', start: 70, end: 90 },
        ],
        20
      )
    );
    expect(placed.a).toMatchObject({ column: 0, columns: 2 });
    expect(placed.b).toMatchObject({ column: 1, columns: 2 });
  });
});
