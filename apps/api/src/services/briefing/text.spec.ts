import { describe, expect, it } from 'vitest';

import {
  billsLine,
  budgetLine,
  currencyLine,
  dayLine,
  firstSentences,
  freeWindow,
  holidayLine,
  monthLine,
  moonPhase,
  quoteLine,
  staleLine,
  stocksLine,
  streakDays,
  tideExtremes,
  tideLine,
  when,
  yesterdayLine,
} from './text';
import { QUOTE_STRIDE, quotes } from './quotes';

const TZ = 'America/Sao_Paulo';
// Segunda, 19/10/2026, 10:00 em São Paulo.
const NOW = new Date('2026-10-19T13:00:00Z');
const TODAY = '2026-10-19';
const event = (start: string, end: string, title = 'Reunião', allDay = false) => ({
  title,
  startAt: start,
  endAt: end,
  allDay,
});

describe('when', () => {
  it('fala hoje, amanhã, o dia da semana e a data', () => {
    expect(when(TODAY, TODAY)).toBe('hoje');
    expect(when('2026-10-20', TODAY)).toBe('amanhã');
    expect(when('2026-10-23', TODAY)).toBe('na sexta-feira');
    expect(when('2026-10-24', TODAY)).toBe('no sábado');
    expect(when('2026-11-02', TODAY)).toBe('em 02/11');
  });
});

describe('dayLine', () => {
  it('dia livre', () => {
    const l = dayLine({ events: [], tasks: 0, overdue: 0, now: NOW, timeZone: TZ });
    expect(l.text).toMatch(/Dia livre/);
    expect(l.tone).toBe('good');
  });

  it('conta compromissos e diz o próximo', () => {
    const l = dayLine({
      events: [
        event('2026-10-19T11:00:00Z', '2026-10-19T12:00:00Z', 'Café'),
        event('2026-10-19T17:00:00Z', '2026-10-19T18:00:00Z', 'Dentista'),
      ],
      tasks: 3,
      overdue: 1,
      now: NOW,
      timeZone: TZ,
    });
    expect(l.text).toBe(
      'Hoje: 2 compromissos, o próximo às 14:00 (Dentista) e 3 tarefas (1 atrasada).'
    );
  });

  it('o primeiro, e o que está acontecendo agora', () => {
    const first = dayLine({
      events: [event('2026-10-19T17:00:00Z', '2026-10-19T18:00:00Z', 'Dentista')],
      tasks: 0,
      overdue: 0,
      now: NOW,
      timeZone: TZ,
    });
    expect(first.text).toBe('Hoje: 1 compromisso, o primeiro às 14:00 (Dentista).');
    const live = dayLine({
      events: [event('2026-10-19T12:30:00Z', '2026-10-19T14:00:00Z', 'Aula')],
      tasks: 1,
      overdue: 1,
      now: NOW,
      timeZone: TZ,
    });
    expect(live.text).toBe('Hoje: 1 compromisso, agora: Aula e 1 tarefa (atrasada).');
  });
});

describe('freeWindow', () => {
  it('acha o maior buraco até as 20h', () => {
    const l = freeWindow(
      [
        event('2026-10-19T13:00:00Z', '2026-10-19T14:00:00Z'), // 10–11
        event('2026-10-19T15:00:00Z', '2026-10-19T16:00:00Z'), // 12–13
        event('2026-10-19T21:00:00Z', '2026-10-19T22:00:00Z'), // 18–19
      ],
      TODAY,
      NOW,
      TZ
    );
    expect(l?.text).toBe('Livre das 13:00 às 18:00.');
  });

  it('livre agora', () => {
    const l = freeWindow([event('2026-10-19T20:00:00Z', '2026-10-19T21:00:00Z')], TODAY, NOW, TZ);
    expect(l?.text).toBe('Livre agora até as 17:00.');
  });

  it('sem compromisso com horário ou depois das 19h não diz nada', () => {
    expect(freeWindow([], TODAY, NOW, TZ)).toBeNull();
    expect(
      freeWindow(
        [event('2026-10-19T20:00:00Z', '2026-10-19T21:00:00Z')],
        TODAY,
        new Date('2026-10-19T22:30:00Z'),
        TZ
      )
    ).toBeNull();
  });
});

describe('staleLine', () => {
  it('prefere a atrasada; sem data só depois de duas semanas', () => {
    expect(staleLine({ title: 'CNH', due: '2026-10-15' }, null, TODAY)?.text).toBe(
      '“CNH” está atrasada há 4 dias.'
    );
    expect(staleLine(null, { title: 'Ler', created: '2026-10-10' }, TODAY)).toBeNull();
    expect(staleLine(null, { title: 'Ler', created: '2026-09-20' }, TODAY)?.text).toMatch(
      /sem data há 4 semanas/
    );
  });
});

describe('streakDays', () => {
  it('conta os dias seguidos fechados', () => {
    const done = new Set(['2026-10-16', '2026-10-17', '2026-10-18']);
    expect(streakDays([], done, TODAY)).toBe(3);
    // Uma tarefa do dia 17 ficou aberta: quebra a sequência.
    expect(streakDays([{ day: '2026-10-17', doneDay: null }], done, TODAY)).toBe(1);
    // Concluída só depois do dia também quebra.
    expect(streakDays([{ day: '2026-10-17', doneDay: '2026-10-18' }], done, TODAY)).toBe(1);
    // Hoje já fechado entra na conta.
    expect(streakDays([], new Set([...done, TODAY]), TODAY)).toBe(4);
  });
});

describe('finanças', () => {
  it('contas da semana', () => {
    const l = billsLine(
      [
        { description: 'Luz', amountCents: 20000, date: '2026-10-20' },
        { description: 'Aluguel', amountCents: 150000, date: '2026-10-23' },
      ],
      0,
      TODAY
    );
    expect(l?.text).toBe(
      '2 contas vencem nos próximos 7 dias, somando {0}. A maior é Aluguel, {1} na sexta-feira.'
    );
    expect(l?.values).toEqual([170000, 150000]);
    expect(billsLine([], 0, TODAY)).toBeNull();
    expect(billsLine([], 2, TODAY)?.tone).toBe('bad');
  });

  it('orçamento', () => {
    expect(
      budgetLine([{ name: 'Mercado', ratio: 0.5, spentCents: 1, limitCents: 2 }], 12)
    ).toBeNull();
    expect(
      budgetLine([{ name: 'Mercado', ratio: 0.85, spentCents: 85, limitCents: 100 }], 12)?.text
    ).toBe('Mercado já usou 85% do orçamento e faltam 12 dias para o mês acabar.');
    expect(
      budgetLine(
        [
          { name: 'Mercado', ratio: 0.85, spentCents: 85, limitCents: 100 },
          { name: 'Lazer', ratio: 1.02, spentCents: 102, limitCents: 100 },
        ],
        12
      )?.text
    ).toBe('Lazer (102%) e Mercado (85%) estão no limite do orçamento.');
  });

  it('mês e ontem', () => {
    expect(monthLine(9000, 10000, 'setembro')?.text).toBe(
      'Você gastou {0} este mês, 10% a menos que no mesmo ponto de setembro.'
    );
    expect(monthLine(0, 0, 'setembro')).toBeNull();
    expect(yesterdayLine(2, 5000)?.text).toBe('Ontem você concluiu 2 tarefas e gastou {0}.');
    expect(yesterdayLine(0, 0)).toBeNull();
  });
});

describe('de fora', () => {
  it('cotação', () => {
    expect(
      currencyLine([
        { code: 'USD', valueBrl: 5.0453, change: -0.003 },
        { code: 'BTC', valueBrl: 413295, change: 0.012 },
      ])?.text
    ).toBe('Dólar R$ 5,05 (−0,3%), Bitcoin R$ 413.295 (+1,2%).');
  });

  it('feriados', () => {
    const list = [
      { date: '2026-11-02', name: 'Finados' },
      { date: '2026-11-15', name: 'Proclamação da República' },
    ];
    expect(holidayLine(list, TODAY)?.text).toBe(
      'Próximo feriado: Finados, 02/11 (daqui a 14 dias).'
    );
    expect(holidayLine(list, '2026-11-02')?.text).toBe('Hoje é feriado: Finados.');
    expect(holidayLine(list, '2026-12-20')).toBeNull();
  });

  it('lua', () => {
    // Lua cheia em 26/10/2026 (aprox.).
    expect(moonPhase(new Date('2026-10-26T04:00:00Z')).name).toBe('Lua cheia');
    expect(moonPhase(new Date('2026-10-26T04:00:00Z')).illumination).toBeGreaterThan(95);
  });

  it('primeiras frases', () => {
    expect(firstSentences('One. Two! Three?', 9)).toBe('One. Two!');
  });
});

describe('stocksLine', () => {
  const quote = (ticker: string, currency: string, price: number, change: number | null) => ({
    ticker,
    period: 'day' as const,
    name: null,
    currency,
    price,
    reference: null,
    change,
    points: [],
  });

  it('mostra preço na moeda da bolsa e a variação, e leva as cotações para o gráfico', () => {
    const quotes = [
      quote('PETR4', 'BRL', 57.64, -0.00621),
      quote('AAPL', 'USD', 340.672, 0.012),
      quote('XPTO3', 'BRL', 1, null),
    ];
    const result = stocksLine(quotes);
    expect(result?.text).toBe('PETR4 R$ 57,64 (−0,6%), AAPL US$ 340,67 (+1,2%), XPTO3 R$ 1,00.');
    expect(result?.stocks).toBe(quotes);
    expect(stocksLine([])).toBeNull();
  });

  it('diz o período quando não é o dia', () => {
    expect(stocksLine([quote('VALE3', 'BRL', 66.09, -0.089)], 'month')?.text).toBe(
      'VALE3 R$ 66,09 (−8,9% no mês).'
    );
    expect(stocksLine([quote('VALE3', 'BRL', 66.09, 0.021)], 'week')?.text).toBe(
      'VALE3 R$ 66,09 (+2,1% em 7 dias).'
    );
  });
});

describe('tideLine', () => {
  // Meia maré de 15 em 15 minutos: baixa às 03:00, alta às 09:15, baixa às 15:30.
  const levels: [string, number][] = [
    ['02:30', 0.1],
    ['02:45', 0.0],
    ['03:00', -0.1],
    ['03:15', 0.0],
    ['09:00', 0.6],
    ['09:15', 0.7],
    ['09:30', 0.7],
    ['09:45', 0.5],
    ['15:15', 0.15],
    ['15:30', 0.1],
    ['15:45', 0.2],
  ];
  const points = levels.map(([time, level]) => ({ time: `${TODAY}T${time}`, level }));

  it('acha altas e baixas, com pico repetido contando uma vez', () => {
    expect(tideExtremes(points).map((e) => `${e.kind} ${e.time.slice(11)}`)).toEqual([
      'baixa 03:00',
      'alta 09:30',
      'baixa 15:30',
    ]);
  });

  it('ignora a ondulação pequena entre uma maré e outra', () => {
    // Santos em 20/10/2026: a "subida" de 0,10 para 0,14 m às 17h não é maré alta.
    const santos = [0.63, 0.36, 0.18, 0.11, 0.1, 0.13, 0.14, 0.05, -0.05, -0.04, 0.14, 0.39].map(
      (level, i) => ({ time: `${TODAY}T${String(11 + i).padStart(2, '0')}:00`, level })
    );
    expect(tideExtremes([{ time: `${TODAY}T10:00`, level: 0.5 }, ...santos])).toEqual([
      { time: `${TODAY}T11:00`, level: 0.63, kind: 'alta' },
      { time: `${TODAY}T19:00`, level: -0.05, kind: 'baixa' },
    ]);
  });

  it('diz se sobe ou baixa e as próximas duas', () => {
    expect(tideLine('Santos, São Paulo, Brasil', points, `${TODAY}T03:20`, TODAY).text).toBe(
      'Maré em Santos subindo (0,0 m agora). Alta às 09:30 (0,7 m) e baixa às 15:30 (0,1 m).'
    );
    const tomorrow = points.map((p, i) =>
      i < 4 ? p : { ...p, time: p.time.replace(TODAY, '2026-10-20') }
    );
    expect(tideLine('Santos', tomorrow, `${TODAY}T02:50`, TODAY).text).toBe(
      'Maré em Santos baixando (0,0 m agora). Baixa às 03:00 (−0,1 m) e alta amanhã às 09:30 (0,7 m).'
    );
  });
});

describe('quoteLine', () => {
  it('traz sempre o autor e muda a cada dia', () => {
    const first = quoteLine('2026-10-19').text;
    expect(first).toMatch(/^“.+” — .+$/);
    expect(quoteLine('2026-10-19').text).toBe(first);
    expect(quoteLine('2026-10-20').text).not.toBe(first);
  });

  it('percorre a lista toda sem repetir antes de dar a volta', () => {
    const days = Array.from({ length: quotes.length }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      return quoteLine(date).text;
    });
    expect(new Set(days).size).toBe(quotes.length);
  });

  it('o passo é primo com o tamanho da lista', () => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    expect(gcd(QUOTE_STRIDE, quotes.length)).toBe(1);
  });
});
