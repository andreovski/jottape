import { z } from 'zod';

import { eventOccurrenceSchema } from './events';

/**
 * Plugins do briefing da tela Hoje, na ordem padrão. Os do começo usam só os dados do app; os
 * do fim buscam dados de fora (clima, maré, horóscopo, cotação, ações, feriados).
 */
export const briefingPluginIds = [
  'day',
  'free',
  'bills',
  'balance',
  'budget',
  'stale',
  'yesterday',
  'month',
  'streak',
  'weather',
  'tide',
  'horoscope',
  'currency',
  'stocks',
  'holidays',
  'moon',
  'quote',
] as const;
export const briefingPluginIdSchema = z.enum(briefingPluginIds);
export type BriefingPluginId = z.infer<typeof briefingPluginIdSchema>;

/** Ligados para quem nunca personalizou. */
export const defaultBriefingPlugins: BriefingPluginId[] = [
  'day',
  'free',
  'bills',
  'balance',
  'budget',
  'stale',
];

export const zodiacSigns = [
  'aries',
  'touro',
  'gemeos',
  'cancer',
  'leao',
  'virgem',
  'libra',
  'escorpiao',
  'sagitario',
  'capricornio',
  'aquario',
  'peixes',
] as const;
export const zodiacSignSchema = z.enum(zodiacSigns);
export type ZodiacSign = z.infer<typeof zodiacSignSchema>;

export const briefingCurrencies = ['USD', 'EUR', 'GBP', 'BTC'] as const;
export const briefingCurrencySchema = z.enum(briefingCurrencies);
export type BriefingCurrency = z.infer<typeof briefingCurrencySchema>;

/**
 * Código de uma ação como na bolsa ("PETR4", "BOVA11", "AAPL"). Os no formato da B3 (quatro
 * letras e um número) são buscados na B3; os outros, como foram digitados.
 */
export const stockTickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\^?[A-Z0-9][A-Z0-9.-]{0,11}$/, 'Código inválido.');

export const briefingStocksMax = 10;

export const briefingCitySchema = z.object({
  /** Nome para mostrar ("Goiânia, Goiás"). */
  name: z.string().trim().min(1).max(160),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type BriefingCity = z.infer<typeof briefingCitySchema>;

export const briefingSettingsSchema = z.object({
  /** Todos os plugins, na ordem em que aparecem. */
  plugins: z
    .array(z.object({ id: briefingPluginIdSchema, enabled: z.boolean() }))
    .max(briefingPluginIds.length)
    .refine((list) => new Set(list.map((p) => p.id)).size === list.length, 'Plugin repetido.'),
  sign: zodiacSignSchema.nullable(),
  city: briefingCitySchema.nullable(),
  currencies: z.array(briefingCurrencySchema).max(briefingCurrencies.length),
  /** Ligada: a linha do tempo segue os momentos do dia. Desligada: vale a ordem de `plugins`. */
  autoOrder: z.boolean().default(true),
  /** Ações do plugin de ações, na ordem em que aparecem. */
  stocks: z.array(stockTickerSchema).max(briefingStocksMax).default([]),
});
export type BriefingSettings = z.infer<typeof briefingSettingsSchema>;

export function defaultBriefingSettings(): BriefingSettings {
  return {
    plugins: briefingPluginIds.map((id) => ({ id, enabled: defaultBriefingPlugins.includes(id) })),
    sign: null,
    city: null,
    currencies: ['USD', 'EUR'],
    autoOrder: true,
    stocks: [],
  };
}

/**
 * Ajustes salvos completados: plugin novo (que não existia quando o usuário salvou) entra
 * desligado no fim; plugin que deixou de existir sai. O que não validar volta ao padrão.
 */
export function normalizeBriefingSettings(saved: unknown): BriefingSettings {
  const fallback = defaultBriefingSettings();
  if (!saved || typeof saved !== 'object') return fallback;
  const raw = saved as Record<string, unknown>;

  const plugins: BriefingSettings['plugins'] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.plugins) ? raw.plugins : []) {
    const parsed = z.object({ id: briefingPluginIdSchema, enabled: z.boolean() }).safeParse(item);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    plugins.push(parsed.data);
  }
  for (const id of briefingPluginIds) {
    if (!seen.has(id)) plugins.push({ id, enabled: false });
  }

  const sign = zodiacSignSchema.safeParse(raw.sign);
  const city = briefingCitySchema.safeParse(raw.city);
  const currencies = z.array(briefingCurrencySchema).safeParse(raw.currencies);
  const stocks = z.array(stockTickerSchema).safeParse(raw.stocks);
  return {
    plugins: seen.size > 0 ? plugins : fallback.plugins,
    sign: sign.success ? sign.data : null,
    city: city.success ? city.data : null,
    currencies: currencies.success ? [...new Set(currencies.data)] : fallback.currencies,
    autoOrder: typeof raw.autoOrder === 'boolean' ? raw.autoOrder : true,
    stocks: stocks.success ? [...new Set(stocks.data)].slice(0, briefingStocksMax) : [],
  };
}

export const briefingToneSchema = z.enum(['neutral', 'good', 'warning', 'bad']);
export type BriefingTone = z.infer<typeof briefingToneSchema>;

export const briefingItemSchema = z.object({
  plugin: briefingPluginIdSchema,
  /**
   * Frase pronta. `{0}`, `{1}`... marcam valores em dinheiro do usuário (em `values`, centavos):
   * o app formata, ou troca por asteriscos quando o saldo está oculto.
   */
  text: z.string(),
  values: z.array(z.number().int()),
  tone: briefingToneSchema,
  /** Para onde o toque leva, quando faz sentido. */
  href: z.string().nullable(),
});
export type BriefingItem = z.infer<typeof briefingItemSchema>;

/** Céu de agora na cidade do clima, para o fundo do briefing. */
export const briefingSkySchema = z.object({
  /** Código WMO do Open-Meteo. */
  code: z.number().int(),
  temperature: z.number(),
  isDay: z.boolean(),
});
export type BriefingSky = z.infer<typeof briefingSkySchema>;

export const briefingResponseSchema = z.object({
  date: z.string(),
  items: z.array(briefingItemSchema),
  /** Só com o plugin de clima ligado e respondendo. */
  sky: briefingSkySchema.nullable(),
  /** Como a timeline agrupa: pelos momentos do dia ou na ordem do usuário. */
  autoOrder: z.boolean().default(true),
});
export type BriefingResponse = z.infer<typeof briefingResponseSchema>;

/** Uma ação conferida antes de entrar na lista. */
export const stockQuoteSchema = z.object({
  ticker: z.string(),
  name: z.string().nullable(),
  /** Moeda da cotação ("BRL", "USD"). */
  currency: z.string(),
  price: z.number(),
  /** Variação desde o fechamento anterior (0,012 = +1,2%). */
  change: z.number().nullable(),
});
export type StockQuote = z.infer<typeof stockQuoteSchema>;

export const stockLookupQuerySchema = z.object({ ticker: stockTickerSchema });

export const citySearchQuerySchema = z.object({ q: z.string().trim().min(2).max(80) });
export type CitySearchQuery = z.infer<typeof citySearchQuerySchema>;

/** Próximo compromisso a partir de um instante (para quando o dia está vazio). */
export const nextEventQuerySchema = z.object({ from: z.string().datetime({ offset: true }) });
export const nextEventResponseSchema = z.object({ event: eventOccurrenceSchema.nullable() });
export type NextEventResponse = z.infer<typeof nextEventResponseSchema>;
