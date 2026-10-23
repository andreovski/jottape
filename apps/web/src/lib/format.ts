import { formatCents, startOfDayInZone } from '@jottape/finance-engine';

// Formatação em pt-BR no fuso do usuário (vem do perfil; até ele carregar, o do navegador).
let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';

export function setAppTimeZone(zone: string) {
  timeZone = zone;
}

export function appTimeZone() {
  return timeZone;
}

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(options: Intl.DateTimeFormatOptions, zone = timeZone) {
  const key = zone + JSON.stringify(options);
  let formatter = cache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('pt-BR', { timeZone: zone, ...options });
    cache.set(key, formatter);
  }
  return formatter;
}

export const money = (cents: number) => formatCents(cents);

/**
 * Cor de um valor que entra ou sai: verde entrada, vermelho saída (sem "+" nem "−" no texto).
 * Previsto (ainda não lançado) usa a mesma cor, mais transparente. Zero fica neutro.
 */
export function amountTone(cents: number, planned = false) {
  if (cents > 0) return planned ? 'text-green/60' : 'text-green';
  if (cents < 0) return planned ? 'text-red/60' : 'text-red';
  return planned ? 'text-label-2' : undefined;
}

/** "AAAA-MM-DD" de um instante, no fuso do app. */
export function dayKey(instant: Date | string, zone = timeZone) {
  const key = `iso:${zone}`;
  let formatter = cache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    cache.set(key, formatter);
  }
  return formatter.format(new Date(instant));
}

/** Meia-noite (instante) de um dia no fuso do app. */
export const startOfDay = (key: string) => startOfDayInZone(key, timeZone);

export const todayKey = () => dayKey(new Date());

/** Date ao meio-dia UTC de um "AAAA-MM-DD": formatar um dia sem hora nunca escorrega de fuso. */
export const dateFromKey = (key: string) => new Date(`${key}T12:00:00Z`);

export const time = (instant: Date | string) =>
  fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(instant));

/** "sábado, 18 de outubro" */
export const longDay = (key: string) =>
  fmt({ weekday: 'long', day: 'numeric', month: 'long' }, 'UTC').format(dateFromKey(key));

/** "18 de out." */
export const shortDay = (key: string) =>
  fmt({ day: 'numeric', month: 'short' }, 'UTC').format(dateFromKey(key));

export const weekdayShort = (key: string) =>
  fmt({ weekday: 'short' }, 'UTC').format(dateFromKey(key)).replace('.', '');

export const weekdayNarrow = (key: string) =>
  fmt({ weekday: 'narrow' }, 'UTC').format(dateFromKey(key));

/** "outubro de 2026" */
export const monthTitle = (month: string) =>
  fmt({ month: 'long', year: 'numeric' }, 'UTC').format(dateFromKey(`${month}-01`));

export const monthName = (month: string) =>
  fmt({ month: 'long' }, 'UTC').format(dateFromKey(`${month}-01`));

/** "Hoje", "Amanhã", "Ontem" ou "qua., 22 de out." */
export function relativeDay(key: string, today = todayKey()) {
  const diff = Math.round((dateFromKey(key).getTime() - dateFromKey(today).getTime()) / 86_400_000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return fmt(
    { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) },
    'UTC'
  ).format(dateFromKey(key));
}

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "08:00 – 09:30" */
export const timeRange = (start: string, end: string) => `${time(start)} – ${time(end)}`;

/** Duração legível: "45 min", "1 h 30". */
export function duration(start: string, end: string) {
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

/** Custo em dólar com casas suficientes para centavos de centavo (US$ 0,00042). */
export function usd(micros: number) {
  return `US$\u00a0${(micros / 1_000_000).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: micros < 10_000 ? 5 : 4,
  })}`;
}
