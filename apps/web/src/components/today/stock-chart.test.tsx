import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StockList } from './stock-chart';

const quote = {
  ticker: 'PETR4',
  period: 'day' as const,
  name: null,
  currency: 'BRL',
  price: 57.95,
  reference: 58,
  change: -0.00086,
  points: [58.1, 57.8, 57.95],
};

describe('StockList', () => {
  it('mostra código, preço, variação e o gráfico', () => {
    const { container } = render(<StockList stocks={[quote]} />);
    expect(screen.getByText('PETR4')).toBeTruthy();
    expect(screen.getByText('R$ 57,95')).toBeTruthy();
    expect(screen.getByText('−0,1%')).toBeTruthy();
    expect(container.querySelector('polyline')).toBeTruthy();
  });

  it('sem série (cotação de reserva) fica sem gráfico', () => {
    const { container } = render(
      <StockList stocks={[{ ...quote, points: [], reference: null }]} />
    );
    expect(screen.getByText('PETR4')).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
  });
});
