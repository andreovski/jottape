import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransactionSheet } from './transaction-sheet';

const createMutate = vi.fn();

vi.mock('@/features/finance', () => {
  const mutation = (fn = vi.fn()) => ({ mutateAsync: fn, mutate: fn, isPending: false });
  return {
    useAccounts: () => ({
      data: [
        {
          id: 'acc-1',
          name: 'Nubank',
          type: 'CHECKING',
          archived: false,
          color: null,
          balanceCents: 0,
        },
      ],
    }),
    useCategories: () => ({
      data: [
        { id: 'cat-1', name: 'Mercado', kind: 'EXPENSE', parentId: null, icon: null, color: null },
      ],
    }),
    useCreateTransaction: () => mutation(createMutate),
    useUpdateTransaction: () => mutation(),
    useDeleteTransaction: () => mutation(),
  };
});

describe('TransactionSheet', () => {
  beforeEach(() => {
    createMutate.mockReset();
    createMutate.mockResolvedValue([]);
  });

  it('mostra os campos faltando ao tocar em "Adicionar", e cria parcelado', async () => {
    const onOpenChange = vi.fn();
    render(<TransactionSheet open onOpenChange={onOpenChange} />);

    const add = await screen.findByRole('button', { name: 'Adicionar' });
    expect(add).toBeEnabled();
    expect(screen.queryByText('Informe o valor.')).not.toBeInTheDocument();

    fireEvent.click(add);
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Informe o valor.')).toBeInTheDocument();
    expect(screen.getByText('Informe a descrição.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '10000' } });
    expect(screen.queryByText('Informe o valor.')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Descrição'), { target: { value: 'Geladeira' } });
    expect(screen.queryByText('Informe a descrição.')).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Não repete'), { target: { value: 'installments' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mais parcelas' }));
    expect(screen.getByText(/3× de R\$\s33,34/)).toBeInTheDocument();

    fireEvent.click(add);
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'EXPENSE',
        amountCents: 10000,
        description: 'Geladeira',
        accountId: 'acc-1',
        installments: 3,
      })
    );
    expect(createMutate.mock.calls[0][0]).not.toHaveProperty('recurrence');
  });
});
