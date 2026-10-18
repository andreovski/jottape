import { dateStringInZone, dateStringToUtc, utcToDateString } from '@jottape/finance-engine';

// Colunas DATE do Prisma chegam como Date à meia-noite UTC.
export const toDbDate = (value: string) => dateStringToUtc(value);
export const fromDbDate = (value: Date) => utcToDateString(value);

/** Hoje (AAAA-MM-DD) no fuso do usuário. */
export function todayIn(timeZone: string, now = new Date()): string {
  return dateStringInZone(now, timeZone);
}
