import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(cleanup);

// Este setup roda em todo arquivo de teste do projeto, inclusive server.test.ts,
// que declara `@vitest-environment node` e portanto não tem window/Element. Os
// stubs de DOM abaixo só existem sob jsdom.
if (typeof window !== 'undefined') {
  // jsdom não implementa window.matchMedia. Componentes do Radix e hooks de
  // responsividade chamam sem checar.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // jsdom não implementa ResizeObserver/IntersectionObserver. O react-popper
  // (por trás de Popover, Tooltip, Select, DropdownMenu) referencia
  // ResizeObserver mesmo em componentes que nunca leem tamanho de volta, então
  // precisa ser stub global e não opt-in por teste.
  class ResizeObserverStub {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  class IntersectionObserverStub {
    root = null;
    rootMargin = '';
    thresholds: ReadonlyArray<number> = [];
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
  }

  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver ??=
    IntersectionObserverStub as unknown as typeof IntersectionObserver;

  // jsdom não implementa nenhum destes em Element.prototype. Usados por
  // radix-ui (posicionamento de Select) e por componentes de drawer/command.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}
