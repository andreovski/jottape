import { addDays } from '@jottape/finance-engine';
import type { BriefingCity, BriefingCurrency, ZodiacSign } from '@jottape/schemas';
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { firstSentences, type Rate, signNames, type Weather } from './text';

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
      current: 'temperature_2m,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: timeZone,
      forecast_days: '1',
    });
    const data = await getJson<{
      current: { temperature_2m: number; weather_code: number };
      daily: {
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: (number | null)[];
      };
    }>(`https://api.open-meteo.com/v1/forecast?${params}`);
    return {
      current: data.current.temperature_2m,
      code: data.current.weather_code,
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
