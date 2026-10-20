import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '@/lib/query-client';

import { CurrentUserContext, useCurrentUser, useLogout, useMe } from './auth';

vi.mock('@/lib/api', () => ({
  api: {
    get: () => ({ json: async () => ({ name: 'André Luiz', email: 'a@b.c' }) }),
    delete: async () => undefined,
  },
  isUnauthorized: () => false,
  errorMessage: async () => '',
}));

function Profile() {
  const me = useCurrentUser();
  const logout = useLogout();
  return (
    <button type='button' onClick={() => logout.mutate()}>
      Sair {me.name}
    </button>
  );
}

function Gate() {
  const me = useMe();
  if (me.isPending) return null;
  if (!me.data) return <p>Entrar</p>;
  return (
    <CurrentUserContext value={me.data}>
      <Profile />
    </CurrentUserContext>
  );
}

describe('useLogout', () => {
  it('volta para a tela de entrada sem renderizar a página com o perfil vazio', async () => {
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Gate />
      </QueryClientProvider>
    );
    fireEvent.click(await screen.findByText('Sair André Luiz'));
    await waitFor(() => expect(screen.getByText('Entrar')).toBeInTheDocument());
  });
});
