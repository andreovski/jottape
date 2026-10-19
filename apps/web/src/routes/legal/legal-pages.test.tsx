import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '@/App';
import { createAppRouter } from '@/router';

afterEach(() => vi.unstubAllGlobals());

describe('páginas legais', () => {
  it.each([
    ['/privacidade', 'Política de privacidade'],
    ['/termos', 'Termos de uso'],
  ])('%s abre sem login e sem chamar a API', async (path, title) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(<App router={createAppRouter(createMemoryHistory({ initialEntries: [path] }))} />);

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('declara o Uso Limitado dos dados do Google', async () => {
    vi.stubGlobal('fetch', vi.fn());
    render(
      <App router={createAppRouter(createMemoryHistory({ initialEntries: ['/privacidade'] }))} />
    );

    expect(await screen.findByText(/requisitos de Uso Limitado/)).toBeInTheDocument();
  });
});
