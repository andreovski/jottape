import type { BriefingItem, BriefingPluginId, BriefingSky } from '@jottape/schemas';

// Fundo do briefing: um "papel de parede" que segue o céu de agora (com o plugin de clima) ou,
// sem ele, a hora do dia. Tons médios para o texto branco ler bem em cima.

export type SkyKind =
  | 'clear-day'
  | 'clear-night'
  | 'cloudy-day'
  | 'cloudy-night'
  | 'rain-day'
  | 'rain-night'
  | 'storm'
  | 'fog'
  | 'snow'
  | 'dawn'
  | 'dusk';

export interface SkyTheme {
  kind: SkyKind;
  /** Três cores, de cima para baixo. */
  colors: [string, string, string];
  /** Brilho no canto (sol, lua ou nada). */
  glow: 'sun' | 'moon' | 'none';
  rain: boolean;
}

const PALETTES: Record<SkyKind, Omit<SkyTheme, 'kind'>> = {
  'clear-day': { colors: ['#1A66D6', '#3A8EEF', '#69B2F5'], glow: 'sun', rain: false },
  'clear-night': { colors: ['#0B1640', '#23306E', '#4B3F8F'], glow: 'moon', rain: false },
  'cloudy-day': { colors: ['#4F6987', '#6F88A6', '#93A9C0'], glow: 'sun', rain: false },
  'cloudy-night': { colors: ['#161C2A', '#29334A', '#43506B'], glow: 'moon', rain: false },
  'rain-day': { colors: ['#2A3C55', '#3F5874', '#5E7A98'], glow: 'none', rain: true },
  'rain-night': { colors: ['#0E1626', '#1F2E45', '#344A66'], glow: 'none', rain: true },
  storm: { colors: ['#17112A', '#33264F', '#56447A'], glow: 'none', rain: true },
  fog: { colors: ['#56626F', '#77838F', '#9AA5B0'], glow: 'none', rain: false },
  snow: { colors: ['#4F7199', '#7896BA', '#A3BCD6'], glow: 'none', rain: false },
  dawn: { colors: ['#B3487A', '#E2706A', '#F2A06B'], glow: 'sun', rain: false },
  dusk: { colors: ['#2A275F', '#7E3C8A', '#D0566F'], glow: 'moon', rain: false },
};

/** Tipo de céu a partir do código WMO, ou da hora quando não há clima. */
export function skyKind(sky: BriefingSky | null, hour: number): SkyKind {
  if (!sky) {
    if (hour >= 5 && hour < 8) return 'dawn';
    if (hour >= 8 && hour < 17) return 'clear-day';
    if (hour >= 17 && hour < 19) return 'dusk';
    return 'clear-night';
  }
  const { code, isDay } = sky;
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return isDay ? 'rain-day' : 'rain-night';
  if (code >= 45) return 'fog';
  if (code === 3) return isDay ? 'cloudy-day' : 'cloudy-night';
  if (isDay) return hour >= 17 && hour < 19 ? 'dusk' : hour < 7 ? 'dawn' : 'clear-day';
  return 'clear-night';
}

export function skyTheme(sky: BriefingSky | null, hour: number): SkyTheme {
  const kind = skyKind(sky, hour);
  return { kind, ...PALETTES[kind] };
}

export function skyGradient(theme: SkyTheme, angle = 165) {
  const [a, b, c] = theme.colors;
  return `linear-gradient(${angle}deg, ${a} 0%, ${b} 52%, ${c} 100%)`;
}

// ---------------------------------------------------------------- linha do tempo

export type MomentKey = 'ontem' | 'agora' | 'hoje' | 'semana' | 'mes' | 'adiante' | 'fim';

/** Em que momento da linha do tempo cada plugin fala. */
const MOMENT_OF: Record<BriefingPluginId, MomentKey> = {
  yesterday: 'ontem',
  streak: 'ontem',
  weather: 'agora',
  currency: 'agora',
  stocks: 'agora',
  moon: 'agora',
  day: 'hoje',
  free: 'hoje',
  stale: 'hoje',
  tide: 'hoje',
  horoscope: 'hoje',
  bills: 'semana',
  budget: 'mes',
  month: 'mes',
  balance: 'adiante',
  holidays: 'adiante',
  quote: 'fim',
};

const MOMENT_ORDER: MomentKey[] = ['ontem', 'agora', 'hoje', 'semana', 'mes', 'adiante', 'fim'];

export interface Moment {
  key: MomentKey;
  items: BriefingItem[];
}

/**
 * Agrupa as frases por momento, do passado para o futuro. Dentro de cada momento vale a ordem
 * escolhida em Ajustes (a mesma em que a API manda).
 */
export function groupMoments(items: BriefingItem[]): Moment[] {
  return MOMENT_ORDER.map((key) => ({
    key,
    items: items.filter((item) => MOMENT_OF[item.plugin] === key),
  })).filter((moment) => moment.items.length > 0);
}

/** Frase do card fechado: o resumo do dia, se estiver ligado; senão a primeira. */
export function headline(items: BriefingItem[]) {
  return items.find((item) => item.plugin === 'day') ?? items[0];
}
