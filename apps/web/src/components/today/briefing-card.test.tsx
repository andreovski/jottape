import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fillValues } from './briefing-card';

describe('briefing', () => {
  it('troca os marcadores pelos valores, ou pelos asteriscos', () => {
    const format = (cents: number) => `R$ ${cents / 100}`;
    render(<p data-testid='a'>{fillValues('Vence {0}; a maior é {1}.', [500, 300], format)}</p>);
    expect(screen.getByTestId('a').textContent).toBe('Vence R$ 5; a maior é R$ 3.');
    render(<p data-testid='b'>{fillValues('Gastou {0}.', [500], () => 'R$ ***')}</p>);
    expect(screen.getByTestId('b').textContent).toBe('Gastou R$ ***.');
  });
});
