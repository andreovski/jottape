import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadLastView, saveLastView } from './last-view';

const isView = (value: unknown): value is 'dia' | 'mes' => value === 'dia' || value === 'mes';

describe('última visão da agenda', () => {
  afterEach(() => localStorage.clear());

  it('devolve a visão salva', () => {
    saveLastView('mes');
    expect(loadLastView(isView)).toBe('mes');
  });

  it('ignora vazio ou valor desconhecido', () => {
    expect(loadLastView(isView)).toBeNull();
    saveLastView('ano');
    expect(loadLastView(isView)).toBeNull();
  });

  it('não quebra quando o storage falha', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => saveLastView('dia')).not.toThrow();
    expect(loadLastView(isView)).toBeNull();
  });
});
