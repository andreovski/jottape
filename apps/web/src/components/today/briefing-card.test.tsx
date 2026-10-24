import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EventList, fillValues } from './briefing-card';

describe('briefing', () => {
  it('troca os marcadores pelos valores, ou pelos asteriscos', () => {
    const format = (cents: number) => `R$ ${cents / 100}`;
    render(<p data-testid='a'>{fillValues('Vence {0}; a maior é {1}.', [500, 300], format)}</p>);
    expect(screen.getByTestId('a').textContent).toBe('Vence R$ 5; a maior é R$ 3.');
    render(<p data-testid='b'>{fillValues('Gastou {0}.', [500], () => 'R$ ***')}</p>);
    expect(screen.getByTestId('b').textContent).toBe('Gastou R$ ***.');
  });

  it('lista os compromissos com horário, dia todo e o que está acontecendo', () => {
    render(
      <EventList
        limit={3}
        events={[
          { title: 'Aniversário', time: null, status: 'upcoming' },
          { title: 'Aula', time: '09:30', status: 'now' },
          { title: 'Dentista', time: '14:00', status: 'upcoming' },
          { title: 'Jantar', time: '20:00', status: 'upcoming' },
        ]}
      />
    );
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['dia todoAniversário', 'agoraAula', '14:00Dentista', '+1']);
  });
});
