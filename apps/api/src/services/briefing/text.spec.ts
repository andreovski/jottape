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
  staleLine,
  streakDays,
  when,
  yesterdayLine,
} from './text';

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
