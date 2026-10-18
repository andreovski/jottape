import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('mantém o tamanho do iOS junto da cor do rótulo', () => {
    expect(cn('text-caption-2 text-label-2', 'text-red')).toBe('text-caption-2 text-red');
  });

  it('troca um tamanho do iOS por outro', () => {
    expect(cn('text-body', 'text-footnote')).toBe('text-footnote');
  });
});
