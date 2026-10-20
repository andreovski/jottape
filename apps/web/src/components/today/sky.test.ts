import type { BriefingItem } from '@jottape/schemas';
import { describe, expect, it } from 'vitest';

import { groupMoments, headline, skyKind } from './sky';

const item = (plugin: BriefingItem['plugin']): BriefingItem => ({
  plugin,
  text: plugin,
  values: [],
  tone: 'neutral',
  href: null,
});

describe('céu do briefing', () => {
  it('segue o código do clima', () => {
    expect(skyKind({ code: 0, temperature: 25, isDay: true }, 12)).toBe('clear-day');
    expect(skyKind({ code: 0, temperature: 18, isDay: false }, 22)).toBe('clear-night');
    expect(skyKind({ code: 3, temperature: 20, isDay: true }, 12)).toBe('cloudy-day');
    expect(skyKind({ code: 63, temperature: 20, isDay: false }, 22)).toBe('rain-night');
    expect(skyKind({ code: 95, temperature: 20, isDay: true }, 12)).toBe('storm');
    expect(skyKind({ code: 45, temperature: 20, isDay: true }, 12)).toBe('fog');
    expect(skyKind({ code: 0, temperature: 25, isDay: true }, 18)).toBe('dusk');
  });

  it('sem clima, segue a hora', () => {
    expect(skyKind(null, 6)).toBe('dawn');
    expect(skyKind(null, 13)).toBe('clear-day');
    expect(skyKind(null, 18)).toBe('dusk');
    expect(skyKind(null, 23)).toBe('clear-night');
  });
});

describe('linha do tempo', () => {
  it('agrupa do passado ao futuro, mantendo a ordem dentro de cada momento', () => {
    const moments = groupMoments(
      ['quote', 'bills', 'stale', 'day', 'weather', 'yesterday', 'balance'].map((p) =>
        item(p as BriefingItem['plugin'])
      )
    );
    expect(moments.map((m) => [m.key, m.items.map((i) => i.plugin)])).toEqual([
      ['ontem', ['yesterday']],
      ['agora', ['weather']],
      ['hoje', ['stale', 'day']],
      ['semana', ['bills']],
      ['adiante', ['balance']],
      ['fim', ['quote']],
    ]);
  });

  it('o card fechado mostra o resumo do dia', () => {
    expect(headline([item('weather'), item('day')]).plugin).toBe('day');
    expect(headline([item('weather'), item('bills')]).plugin).toBe('weather');
  });
});
