import { addDays, diffInDays, wallTimeToInstant } from '@jottape/finance-engine';
import type {
  BriefingItem,
  BriefingPluginId,
  StockPeriod,
  StockQuote,
  ZodiacSign,
} from '@jottape/schemas';

import { QUOTE_STRIDE, quotes } from './quotes';

// Frases do briefing. Funções puras: recebem os dados já lidos e devolvem o texto.

export type Line = Omit<BriefingItem, 'plugin'>;

export function line(text: string, extra: Partial<Line> = {}): Line {
  return { text, values: [], tone: 'neutral', href: null, ...extra };
}

export function withPlugin(plugin: BriefingPluginId, lines: Line[]): BriefingItem[] {
  return lines.map((l) => ({ plugin, ...l }));
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function formatTime(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    instant
  );
}

const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});

/** "hoje", "amanhã", "na sexta-feira" (até 6 dias) ou "em 24/11". */
export function when(date: string, today: string) {
  const diff = diffInDays(today, date);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  const instant = new Date(`${date}T12:00:00Z`);
  if (diff > 1 && diff < 7) {
    const name = weekday.format(instant);
    // sábado e domingo são masculinos.
    return `${name.startsWith('sábado') || name.startsWith('domingo') ? 'no' : 'na'} ${name}`;
  }
  return `em ${dayMonth.format(instant)}`;
}

/** "há 3 dias", "há 2 semanas", "há 4 meses". */
export function since(days: number) {
  if (days < 14) return `há ${plural(days, 'dia', 'dias')}`;
  if (days < 60) return `há ${plural(Math.floor(days / 7), 'semana', 'semanas')}`;
  return `há ${plural(Math.floor(days / 30), 'mês', 'meses')}`;
}

// ---------------------------------------------------------------- agenda

export interface DayInput {
  events: { title: string; startAt: string; endAt: string; allDay: boolean }[];
  tasks: number;
  overdue: number;
  now: Date;
  timeZone: string;
}

export function dayLine({ events, tasks, overdue, now, timeZone }: DayInput): Line {
  if (events.length === 0 && tasks === 0) {
    return line('Dia livre: nada na agenda e nenhuma tarefa para hoje.', { tone: 'good' });
  }
  const parts: string[] = [];
  if (events.length > 0) {
    const timed = events
      .filter((e) => !e.allDay)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    const next = timed.find((e) => new Date(e.endAt) > now);
    let text = plural(events.length, 'compromisso', 'compromissos');
    if (next) {
      const started = new Date(next.startAt) <= now;
      const first = timed[0] === next && !started;
      text += started
        ? `, agora: ${next.title}`
        : `, ${first ? 'o primeiro' : 'o próximo'} às ${formatTime(new Date(next.startAt), timeZone)} (${next.title})`;
    } else if (timed.length > 0) {
      text += ', todos já passaram';
    }
    parts.push(text);
  }
  if (tasks > 0) {
    let text = plural(tasks, 'tarefa', 'tarefas');
    if (overdue > 0)
      text += ` (${overdue === tasks ? (tasks === 1 ? 'atrasada' : 'todas atrasadas') : `${overdue} ${overdue === 1 ? 'atrasada' : 'atrasadas'}`})`;
    parts.push(text);
  }
  return line(`Hoje: ${parts.join(' e ')}.`, { href: events.length ? '/agenda' : '/tarefas' });
}

/**
 * Maior intervalo sem compromissos entre agora e as 20h (começando às 8h), se tiver ao menos
 * uma hora. Sem compromisso com horário, não diz nada: o resumo do dia já fala que está livre.
 */
export function freeWindow(
  events: { startAt: string; endAt: string; allDay: boolean }[],
  today: string,
  now: Date,
  timeZone: string
): Line | null {
  const timed = events.filter((e) => !e.allDay);
  if (timed.length === 0) return null;
  const [year, month, day] = today.split('-').map(Number);
  const at = (hour: number) => wallTimeToInstant({ year, month, day, hour, minute: 0 }, timeZone);
  // Agora arredondado para o próximo quarto de hora.
  const quarter = 15 * 60_000;
  const start = Math.max(at(8).getTime(), Math.ceil(now.getTime() / quarter) * quarter);
  const end = at(20).getTime();
  if (end - start < 60 * 60_000) return null;

  const busy = timed
    .map((e) => [new Date(e.startAt).getTime(), new Date(e.endAt).getTime()] as const)
    .filter(([s, e]) => e > start && s < end)
    .sort((a, b) => a[0] - b[0]);

  let best: [number, number] | null = null;
  let cursor = start;
  for (const [s, e] of [...busy, [end, end] as const]) {
    if (s - cursor > (best ? best[1] - best[0] : 0)) best = [cursor, Math.min(s, end)];
    cursor = Math.max(cursor, e);
  }
  if (!best || best[1] - best[0] < 60 * 60_000) return null;

  const from = formatTime(new Date(best[0]), timeZone);
  const to = formatTime(new Date(best[1]), timeZone);
  const isNow = best[0] <= now.getTime() + quarter;
  return line(isNow ? `Livre agora até as ${to}.` : `Livre das ${from} às ${to}.`, {
    href: '/agenda',
  });
}

// ---------------------------------------------------------------- tarefas

export function staleLine(
  overdue: { title: string; due: string } | null,
  undated: { title: string; created: string } | null,
  today: string
): Line | null {
  if (overdue) {
    const days = diffInDays(overdue.due, today);
    if (days >= 1) {
      return line(`“${overdue.title}” está atrasada ${since(days)}.`, {
        tone: days >= 7 ? 'bad' : 'warning',
        href: '/tarefas',
      });
    }
  }
  if (undated) {
    const days = diffInDays(undated.created, today);
    if (days >= 14) {
      return line(`“${undated.title}” está sem data ${since(days)}. Que tal marcar um dia?`, {
        href: '/tarefas',
      });
    }
  }
  return null;
}

/**
 * Dias seguidos (até ontem, ou até hoje se o dia já fechou) em que o usuário concluiu alguma
 * tarefa e não deixou aberta nenhuma que vencia naquele dia.
 */
export function streakDays(
  due: { day: string; doneDay: string | null }[],
  completedDays: Set<string>,
  today: string,
  maxDays = 60
) {
  const openOn = (day: string) => due.some((t) => t.day === day && (!t.doneDay || t.doneDay > day));
  const closed = (day: string) => completedDays.has(day) && !openOn(day);
  let day = closed(today) ? today : addDays(today, -1);
  let count = 0;
  while (count < maxDays && closed(day)) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}

export function streakLine(days: number): Line | null {
  if (days < 2) return null;
  return line(`${days} dias seguidos fechando todas as tarefas do dia. Continue assim!`, {
    tone: 'good',
    href: '/tarefas',
  });
}

export function yesterdayLine(tasksDone: number, spentCents: number): Line | null {
  if (tasksDone === 0 && spentCents === 0) return null;
  const parts: string[] = [];
  if (tasksDone > 0) parts.push(`concluiu ${plural(tasksDone, 'tarefa', 'tarefas')}`);
  if (spentCents > 0) parts.push('gastou {0}');
  return line(`Ontem você ${parts.join(' e ')}.`, {
    values: spentCents > 0 ? [spentCents] : [],
  });
}

// ---------------------------------------------------------------- finanças

export interface BillDue {
  description: string;
  amountCents: number;
  date: string;
}

export function billsLine(bills: BillDue[], overdue: number, today: string): Line | null {
  if (bills.length === 0 && overdue === 0) return null;
  const href = '/financas?tab=previsao';
  if (bills.length === 0) {
    return line(
      `${plural(overdue, 'conta prevista está atrasada', 'contas previstas estão atrasadas')}.`,
      {
        tone: 'bad',
        href,
      }
    );
  }
  const total = bills.reduce((sum, b) => sum + b.amountCents, 0);
  const biggest = [...bills].sort((a, b) => b.amountCents - a.amountCents)[0];
  let text =
    bills.length === 1
      ? `${biggest.description} vence ${when(biggest.date, today)}: {0}.`
      : `${plural(bills.length, 'conta vence', 'contas vencem')} nos próximos 7 dias, somando {0}. A maior é ${biggest.description}, {1} ${when(biggest.date, today)}.`;
  if (overdue > 0) text += ` E ${plural(overdue, 'está atrasada', 'estão atrasadas')}.`;
  return line(text, {
    values: bills.length === 1 ? [total] : [total, biggest.amountCents],
    tone: overdue > 0 ? 'bad' : bills.some((b) => b.date === today) ? 'warning' : 'neutral',
    href,
  });
}

export function invoiceClosingLine(
  invoice: { accountName: string; closingDate: string; totalCents: number },
  today: string
): Line {
  return line(
    `A fatura do ${invoice.accountName} fecha ${when(invoice.closingDate, today)} com {0}.`,
    {
      values: [invoice.totalCents],
    }
  );
}

export function balanceLine(
  negative: { date: string; balanceCents: number } | null,
  today: string
): Line | null {
  if (!negative) return null;
  return line(
    `Pelo previsto, seu saldo fica negativo ${when(negative.date, today)} e chega a {0}.`,
    { values: [negative.balanceCents], tone: 'bad', href: '/financas?tab=previsao' }
  );
}

export function budgetLine(
  budgets: { name: string; ratio: number; spentCents: number; limitCents: number }[],
  daysLeft: number
): Line | null {
  const tight = budgets.filter((b) => b.ratio >= 0.8).sort((a, b) => b.ratio - a.ratio);
  if (tight.length === 0) return null;
  const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;
  const href = '/financas?tab=orcamentos';
  const over = tight[0].ratio >= 1;
  if (tight.length === 1) {
    const b = tight[0];
    return over
      ? line(`${b.name} passou do orçamento: {0} de {1}.`, {
          values: [b.spentCents, b.limitCents],
          tone: 'bad',
          href,
        })
      : line(
          `${b.name} já usou ${pct(b.ratio)} do orçamento e ${daysLeft === 0 ? 'o mês acaba hoje' : `faltam ${plural(daysLeft, 'dia', 'dias')} para o mês acabar`}.`,
          { tone: 'warning', href }
        );
  }
  const names = tight.slice(0, 3).map((b) => `${b.name} (${pct(b.ratio)})`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : names[0];
  return line(`${list} estão no limite do orçamento.`, { tone: over ? 'bad' : 'warning', href });
}

export function monthLine(
  spentCents: number,
  previousCents: number,
  previousMonthName: string
): Line | null {
  if (spentCents === 0 && previousCents === 0) return null;
  if (previousCents === 0)
    return line('Você gastou {0} este mês.', { values: [spentCents], href: '/financas' });
  const change = (spentCents - previousCents) / previousCents;
  const pct = Math.round(Math.abs(change) * 100);
  const compare =
    pct < 3
      ? `quase o mesmo que no mesmo ponto de ${previousMonthName}`
      : `${pct}% ${change < 0 ? 'a menos' : 'a mais'} que no mesmo ponto de ${previousMonthName}`;
  return line(`Você gastou {0} este mês, ${compare}.`, {
    values: [spentCents],
    tone: pct >= 3 ? (change < 0 ? 'good' : 'warning') : 'neutral',
    href: '/financas',
  });
}

// ---------------------------------------------------------------- de fora

/** Códigos WMO do Open-Meteo. */
export function weatherDescription(code: number) {
  if (code === 0) return 'céu limpo';
  if (code <= 2) return 'poucas nuvens';
  if (code === 3) return 'nublado';
  if (code <= 48) return 'neblina';
  if (code <= 57) return 'garoa';
  if (code <= 67) return 'chuva';
  if (code <= 77) return 'neve';
  if (code <= 82) return 'pancadas de chuva';
  if (code <= 86) return 'neve';
  return 'trovoadas';
}

export interface Weather {
  current: number;
  code: number;
  /** Ausente em respostas guardadas antes deste campo existir. */
  isDay?: boolean;
  max: number;
  min: number;
  rain: number | null;
}

export function weatherLine(city: string, w: Weather): Line {
  const place = city.split(',')[0];
  let text = `${place}: ${Math.round(w.current)}° agora, ${weatherDescription(w.code)}. Máxima de ${Math.round(w.max)}° e mínima de ${Math.round(w.min)}°.`;
  if (w.rain !== null && w.rain >= 40) text += ` Chance de chuva de ${w.rain}%, leve guarda-chuva.`;
  return line(text, { tone: w.rain !== null && w.rain >= 60 ? 'warning' : 'neutral' });
}

export const signNames: Record<ZodiacSign, { pt: string; en: string; symbol: string }> = {
  aries: { pt: 'Áries', en: 'Aries', symbol: '♈' },
  touro: { pt: 'Touro', en: 'Taurus', symbol: '♉' },
  gemeos: { pt: 'Gêmeos', en: 'Gemini', symbol: '♊' },
  cancer: { pt: 'Câncer', en: 'Cancer', symbol: '♋' },
  leao: { pt: 'Leão', en: 'Leo', symbol: '♌' },
  virgem: { pt: 'Virgem', en: 'Virgo', symbol: '♍' },
  libra: { pt: 'Libra', en: 'Libra', symbol: '♎' },
  escorpiao: { pt: 'Escorpião', en: 'Scorpio', symbol: '♏' },
  sagitario: { pt: 'Sagitário', en: 'Sagittarius', symbol: '♐' },
  capricornio: { pt: 'Capricórnio', en: 'Capricorn', symbol: '♑' },
  aquario: { pt: 'Aquário', en: 'Aquarius', symbol: '♒' },
  peixes: { pt: 'Peixes', en: 'Pisces', symbol: '♓' },
};

/** As primeiras frases de um texto, até `max` caracteres (o tradutor aceita 500 bytes). */
export function firstSentences(text: string, max = 200) {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+[.!?]+/g) ?? [text];
  let out = '';
  for (const sentence of sentences) {
    const next = `${out} ${sentence.trim()}`.trim();
    if (next.length > max) break;
    out = next;
  }
  return out || text.slice(0, max).trim();
}

export interface Rate {
  code: string;
  valueBrl: number;
  change: number | null;
}

const currencyNames: Record<string, string> = {
  USD: 'Dólar',
  EUR: 'Euro',
  GBP: 'Libra',
  BTC: 'Bitcoin',
};

const decimal = (value: number, digits: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** " (+1,2%)", " (−0,6%)" ou nada. */
const changeText = (change: number | null) =>
  change === null ? '' : ` (${change >= 0 ? '+' : '−'}${decimal(Math.abs(change) * 100, 1)}%)`;

export function currencyLine(rates: Rate[]): Line | null {
  if (rates.length === 0) return null;
  const parts = rates.map((r) => {
    const value = `R$ ${decimal(r.valueBrl, r.valueBrl >= 1000 ? 0 : 2)}`;
    return `${currencyNames[r.code] ?? r.code} ${value}${changeText(r.change)}`;
  });
  return line(`${parts.join(', ')}.`);
}

const currencySymbols: Record<string, string> = { BRL: 'R$', USD: 'US$', EUR: '€', GBP: '£' };

const periodSuffix: Record<StockPeriod, string> = { day: '', week: ' em 7 dias', month: ' no mês' };

/** A frase serve de resumo e de texto alternativo; o app desenha os gráficos com `stocks`. */
export function stocksLine(quotes: StockQuote[], period: StockPeriod = 'day'): Line | null {
  if (quotes.length === 0) return null;
  const parts = quotes.map((q) => {
    const symbol = currencySymbols[q.currency] ?? q.currency;
    const change =
      q.change === null ? '' : changeText(q.change).replace(/\)$/, `${periodSuffix[period]})`);
    return `${q.ticker} ${symbol} ${decimal(q.price, 2)}${change}`;
  });
  return line(`${parts.join(', ')}.`, { stocks: quotes });
}

// ---------------------------------------------------------------- maré

/** Nível do mar (metros, em relação ao nível médio) com o horário local ("2026-10-20T11:15"). */
export type TideSeries = { time: string; level: number }[];

type TideExtreme = { time: string; level: number; kind: 'alta' | 'baixa' };

/** Abaixo disso, a subida e descida é marola da previsão, não maré. */
const TIDE_MIN_RANGE = 0.1;

/** Marés altas e baixas: os picos e vales da série, sem as ondulações pequenas. */
export function tideExtremes(points: TideSeries) {
  const extremes: TideExtreme[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const [prev, cur, next] = [points[i - 1].level, points[i].level, points[i + 1].level];
    // `>=` com o anterior: com duas casas, o pico às vezes se repete por 15 minutos.
    if (cur >= prev && cur > next) extremes.push({ ...points[i], kind: 'alta' });
    else if (cur <= prev && cur < next) extremes.push({ ...points[i], kind: 'baixa' });
  }
  // Tira o par vizinho que quase não muda; os de fora ficam com o mais extremo de cada tipo.
  const more = (a: TideExtreme, b: TideExtreme) =>
    (a.kind === 'alta' ? b.level > a.level : b.level < a.level) ? b : a;
  for (let i = 0; i < extremes.length - 1; ) {
    if (Math.abs(extremes[i].level - extremes[i + 1].level) >= TIDE_MIN_RANGE) {
      i++;
      continue;
    }
    const [a, b] = [extremes[i], extremes[i + 1]];
    if (i > 0) extremes[i - 1] = more(extremes[i - 1], b);
    if (i + 2 < extremes.length) extremes[i + 2] = more(extremes[i + 2], a);
    extremes.splice(i, 2);
    i = Math.max(i - 1, 0);
  }
  return extremes;
}

/** `now` no horário local, como os pontos ("2026-10-20T10:00"). */
export function tideLine(city: string, points: TideSeries, now: string, today: string): Line {
  const place = city.split(',')[0];
  const meters = (level: number) => `${level < 0 ? '−' : ''}${decimal(Math.abs(level), 1)} m`;
  const index = Math.max(points.filter((p) => p.time <= now).length - 1, 0);
  const current = points[index];
  const after = points[index + 1];
  let text = `Maré em ${place}`;
  if (after) text += after.level >= current.level ? ' subindo' : ' baixando';
  text += ` (${meters(current.level)} agora).`;
  const next = tideExtremes(points)
    .filter((e) => e.time > now)
    .slice(0, 2)
    .map((e) => {
      const day = e.time.slice(0, 10) === today ? '' : 'amanhã ';
      return `${e.kind} ${day}às ${e.time.slice(11, 16)} (${meters(e.level)})`;
    });
  if (next.length) {
    const joined = next.join(' e ');
    text += ` ${joined[0].toUpperCase()}${joined.slice(1)}.`;
  }
  return line(text);
}

export function holidayLine(
  holidays: { date: string; name: string }[],
  today: string
): Line | null {
  const todays = holidays.find((h) => h.date === today);
  if (todays) return line(`Hoje é feriado: ${todays.name}.`, { tone: 'good' });
  const next = holidays
    .filter((h) => h.date > today && diffInDays(today, h.date) <= 45)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!next) return null;
  const days = diffInDays(today, next.date);
  return line(
    `Próximo feriado: ${next.name}, ${when(next.date, today).replace(/^(na|no|em) /, '')}${days > 1 ? ` (daqui a ${days} dias)` : ''}.`
  );
}

/** Fase da lua calculada pela lunação média a partir de uma lua nova conhecida. */
export function moonPhase(at: Date) {
  const synodic = 29.530588853;
  const knownNew = Date.UTC(2000, 0, 6, 18, 14);
  const age = ((((at.getTime() - knownNew) / 86_400_000) % synodic) + synodic) % synodic;
  const illumination = Math.round(((1 - Math.cos((2 * Math.PI * age) / synodic)) / 2) * 100);
  const names = [
    'Lua nova',
    'Lua crescente',
    'Quarto crescente',
    'Lua crescente gibosa',
    'Lua cheia',
    'Lua minguante gibosa',
    'Quarto minguante',
    'Lua minguante',
  ];
  const index = Math.floor((age / synodic) * 8 + 0.5) % 8;
  return { name: names[index], illumination, age };
}

export function moonLine(at: Date): Line {
  const { name, illumination } = moonPhase(at);
  return line(`${name}, ${illumination}% iluminada.`);
}

export function quoteLine(today: string): Line {
  const [y, m, d] = today.split('-').map(Number);
  const day = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  const { text, author } = quotes[(day * QUOTE_STRIDE) % quotes.length];
  return line(`“${text}” — ${author}`);
}
