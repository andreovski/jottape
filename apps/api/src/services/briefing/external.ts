import { addDays } from '@jottape/finance-engine';
import type { BriefingCity, BriefingCurrency, StockQuote, ZodiacSign } from '@jottape/schemas';
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { firstSentences, type Rate, signNames, type TideSeries, type Weather } from './text';

// Serviços públicos e gratuitos, sem chave. A resposta fica guardada (igual para todos os
// usuários), então cada fonte é consultada no máximo uma vez por chave e período.

const TIMEOUT_MS = 5000;
const HOUR = 60 * 60_000;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${new URL(url).host} respondeu ${response.status}`);
  return (await response.json()) as T;
}

/** Valor guardado em `ExternalCache` ou, vencido, buscado de novo. Falha não é guardada. */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await prisma.externalCache.findUnique({ where: { key } });
  if (hit && hit.expiresAt > new Date()) return hit.data as T;
  const data = await load();
  const expiresAt = new Date(Date.now() + ttlMs);
  await prisma.externalCache.upsert({
    where: { key },
    create: { key, data: data as Prisma.InputJsonValue, expiresAt },
    update: { data: data as Prisma.InputJsonValue, expiresAt },
  });
  return data;
}

/** Apaga o que venceu há mais de um dia (roda com os jobs diários). */
export function pruneExternalCache(now = new Date()) {
  return prisma.externalCache.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 24 * HOUR) } },
  });
}

// ---------------------------------------------------------------- clima (Open-Meteo)

export async function weather(city: BriefingCity, timeZone: string): Promise<Weather> {
  const lat = city.latitude.toFixed(2);
  const lon = city.longitude.toFixed(2);
  return cached(`weather:${lat},${lon}`, HOUR, async () => {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: 'temperature_2m,weather_code,is_day',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: timeZone,
      forecast_days: '1',
    });
    const data = await getJson<{
      current: { temperature_2m: number; weather_code: number; is_day?: number };
      daily: {
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: (number | null)[];
      };
    }>(`https://api.open-meteo.com/v1/forecast?${params}`);
    return {
      current: data.current.temperature_2m,
      code: data.current.weather_code,
      isDay: data.current.is_day !== 0,
      max: data.daily.temperature_2m_max[0],
      min: data.daily.temperature_2m_min[0],
      rain: data.daily.precipitation_probability_max[0] ?? null,
    };
  });
}

export async function searchCities(query: string): Promise<BriefingCity[]> {
  const normalized = query.trim().toLowerCase();
  return cached(`cities:${normalized}`, 30 * 24 * HOUR, async () => {
    const params = new URLSearchParams({ name: normalized, count: '8', language: 'pt' });
    const data = await getJson<{
      results?: {
        name: string;
        latitude: number;
        longitude: number;
        admin1?: string;
        country?: string;
      }[];
    }>(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
    return (data.results ?? []).map((r) => ({
      name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      latitude: r.latitude,
      longitude: r.longitude,
    }));
  });
}

// ---------------------------------------------------------------- maré (Open-Meteo Marine)

/**
 * Nível do mar previsto de 15 em 15 minutos, de hoje e amanhã, no horário local. Longe da costa
 * o serviço só devolve vazios: aí vem `null`.
 */
export async function tide(
  city: BriefingCity,
  timeZone: string,
  today: string
): Promise<TideSeries | null> {
  const lat = city.latitude.toFixed(2);
  const lon = city.longitude.toFixed(2);
  const result = await cached(`tide:${lat},${lon}:${today}`, 6 * HOUR, async () => {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      minutely_15: 'sea_level_height_msl',
      timezone: timeZone,
      start_date: today,
      end_date: addDays(today, 1),
    });
    const data = await getJson<{
      minutely_15?: { time: string[]; sea_level_height_msl: (number | null)[] };
    }>(`https://marine-api.open-meteo.com/v1/marine?${params}`);
    const times = data.minutely_15?.time ?? [];
    const levels = data.minutely_15?.sea_level_height_msl ?? [];
    const points = times
      .map((time, i) => ({ time, level: levels[i] }))
      .filter((p): p is { time: string; level: number } => typeof p.level === 'number');
    return { points: points.length >= 8 ? points : null };
  });
  return result.points;
}

// ---------------------------------------------------------------- ações (Yahoo Finance)

/** Quatro letras e um número (PETR4, BOVA11, TAEE11F): é da B3. */
const B3_TICKER = /^[A-Z]{4}\d{1,2}F?$/;

/**
 * Cotação de uma ação. Vem do gráfico público do Yahoo Finance; se ele recusar, da brapi.dev,
 * que sem chave atende parte das ações da B3. `null` quando o código não existe.
 */
export async function stockQuote(ticker: string): Promise<StockQuote | null> {
  const result = await cached(`stock:${ticker}`, 15 * 60_000, async () => {
    try {
      return { quote: await yahooQuote(ticker) };
    } catch (error) {
      if (!B3_TICKER.test(ticker)) throw error;
      return { quote: await brapiQuote(ticker) };
    }
  });
  return result.quote;
}

async function yahooQuote(ticker: string): Promise<StockQuote | null> {
  const symbol = B3_TICKER.test(ticker) ? `${ticker}.SA` : ticker;
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
    {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Sem um navegador como agente, o Yahoo às vezes recusa.
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Jottape)' },
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Yahoo Finance respondeu ${response.status}`);
  const data = (await response.json()) as {
    chart: {
      result:
        | {
            meta: {
              currency?: string;
              regularMarketPrice?: number;
              regularMarketChangePercent?: number;
              shortName?: string;
              longName?: string;
            };
            indicators?: { quote?: { close?: (number | null)[] }[] };
          }[]
        | null;
    };
  };
  const result = data.chart.result?.[0];
  const price = result?.meta.regularMarketPrice;
  if (!result || typeof price !== 'number') return null;
  let change: number | null = null;
  if (typeof result.meta.regularMarketChangePercent === 'number') {
    change = result.meta.regularMarketChangePercent / 100;
  } else {
    const closes = (result.indicators?.quote?.[0]?.close ?? []).filter(
      (c): c is number => typeof c === 'number'
    );
    if (closes.length >= 2) change = price / closes.at(-2)! - 1;
  }
  return {
    ticker,
    name: (result.meta.longName ?? result.meta.shortName ?? '').trim() || null,
    currency: result.meta.currency ?? 'BRL',
    price,
    change,
  };
}

async function brapiQuote(ticker: string): Promise<StockQuote | null> {
  const data = await getJson<{
    results?: {
      longName?: string;
      shortName?: string;
      currency?: string;
      regularMarketPrice?: number;
      regularMarketChangePercent?: number;
    }[];
  }>(`https://brapi.dev/api/quote/${encodeURIComponent(ticker)}`);
  const result = data.results?.[0];
  if (!result || typeof result.regularMarketPrice !== 'number') return null;
  return {
    ticker,
    name: result.longName ?? result.shortName ?? null,
    currency: result.currency ?? 'BRL',
    price: result.regularMarketPrice,
    change:
      typeof result.regularMarketChangePercent === 'number'
        ? result.regularMarketChangePercent / 100
        : null,
  };
}

/** As ações da lista, na ordem dela. A que falhar ou não existir fica de fora. */
export async function stocks(tickers: string[]): Promise<StockQuote[]> {
  const quotes = await Promise.all(tickers.map((t) => stockQuote(t).catch(() => null)));
  const found = quotes.filter((q): q is StockQuote => !!q);
  if (tickers.length > 0 && found.length === 0) throw new Error('Nenhuma cotação de ação');
  return found;
}

// ---------------------------------------------------------------- horóscopo

/**
 * Horóscopo do dia em inglês (horoscope-app-api) traduzido para o português (MyMemory). Fica
 * guardado por signo e dia, então são no máximo 12 traduções por dia.
 */
export async function horoscope(sign: ZodiacSign, today: string): Promise<string> {
  return cached(`horoscope:${sign}:${today}`, 24 * HOUR, async () => {
    const data = await getJson<{ data: { horoscope_data?: string; horoscope?: string } }>(
      `https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=${signNames[sign].en}&day=TODAY`
    );
    const english = firstSentences(data.data.horoscope ?? data.data.horoscope_data ?? '');
    if (!english) throw new Error('Horóscopo vazio');
    const params = new URLSearchParams({ q: english, langpair: 'en|pt-BR' });
    const translated = await getJson<{
      responseStatus: number | string;
      responseData: { translatedText: string };
    }>(`https://api.mymemory.translated.net/get?${params}`);
    const text = translated.responseData.translatedText?.trim();
    if (Number(translated.responseStatus) !== 200 || !text || /MYMEMORY WARNING/i.test(text)) {
      throw new Error('Tradução indisponível');
    }
    return text;
  });
}

// ---------------------------------------------------------------- cotação

/** Moedas (Frankfurter, do Banco Central Europeu) e bitcoin (CoinGecko), em reais. */
export async function rates(codes: BriefingCurrency[], today: string): Promise<Rate[]> {
  const fiat = codes.filter((c) => c !== 'BTC');
  const [fiatRates, btc] = await Promise.all([
    fiat.length
      ? cached(`rates:${[...fiat].sort().join(',')}`, HOUR, async () => {
          // Uma semana para trás: o último dia útil e o anterior dão a variação.
          const data = await getJson<{ rates: Record<string, Record<string, number>> }>(
            `https://api.frankfurter.app/${addDays(today, -7)}..?base=BRL&symbols=${fiat.join(',')}`
          );
          const days = Object.keys(data.rates).sort();
          const last = data.rates[days.at(-1)!];
          const before = days.length > 1 ? data.rates[days.at(-2)!] : null;
          return fiat
            .filter((code) => last?.[code])
            .map((code) => {
              const value = 1 / last[code];
              const previous = before?.[code] ? 1 / before[code] : null;
              return { code, valueBrl: value, change: previous ? value / previous - 1 : null };
            });
        })
      : Promise.resolve([] as Rate[]),
    codes.includes('BTC')
      ? cached('rates:BTC', HOUR, async () => {
          const data = await getJson<{ bitcoin: { brl: number; brl_24h_change?: number } }>(
            'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl&include_24hr_change=true'
          );
          return [
            {
              code: 'BTC',
              valueBrl: data.bitcoin.brl,
              change:
                data.bitcoin.brl_24h_change === undefined
                  ? null
                  : data.bitcoin.brl_24h_change / 100,
            },
          ] as Rate[];
        })
      : Promise.resolve([] as Rate[]),
  ]);
  const all = [...fiatRates, ...btc];
  return codes.map((code) => all.find((r) => r.code === code)).filter((r): r is Rate => !!r);
}

// ---------------------------------------------------------------- feriados (BrasilAPI)

export async function holidays(year: number): Promise<{ date: string; name: string }[]> {
  return cached(`holidays:BR:${year}`, 30 * 24 * HOUR, async () => {
    const data = await getJson<{ date: string; name: string }[]>(
      `https://brasilapi.com.br/api/feriados/v1/${year}`
    );
    return data.map((h) => ({ date: h.date, name: h.name }));
  });
}
