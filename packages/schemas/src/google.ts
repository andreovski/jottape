import { z } from 'zod';

import { idSchema } from './common';

export const googleCalendarResponseSchema = z.object({
  id: z.string(),
  /** Conta Google de onde vem o calendário. */
  accountId: z.string(),
  name: z.string(),
  /** Cor usada na agenda: a escolhida no Jottape, senão a do Google. */
  color: z.string().nullable(),
  /** Cor escolhida no Jottape (null = a do Google). */
  colorOverride: z.string().nullable(),
  primary: z.boolean(),
  selected: z.boolean(),
  syncedAt: z.string().nullable(),
  /** Ids do mesmo calendário do Google visto por outras contas conectadas. */
  alsoIn: z.array(z.string()),
});
export type GoogleCalendarResponse = z.infer<typeof googleCalendarResponseSchema>;

export const googleAccountResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  /** Esta conta sincroniza o Google Tasks. */
  syncTasks: z.boolean(),
  tasksSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  /** O token expirou ou foi revogado: só conectando a conta de novo. */
  needsReconnect: z.boolean(),
});
export type GoogleAccountResponse = z.infer<typeof googleAccountResponseSchema>;

export const googleStatusResponseSchema = z.object({
  /** O servidor tem GOOGLE_CLIENT_ID/SECRET configurados. */
  configured: z.boolean(),
  connected: z.boolean(),
  accounts: z.array(googleAccountResponseSchema),
  /** Calendários de todas as contas, na ordem das contas. */
  calendars: z.array(googleCalendarResponseSchema),
  defaultCalendarId: z.string().nullable(),
  /** Conta do Google Tasks (null = tarefas só no Jottape). */
  tasksAccountId: z.string().nullable(),
  /** Campos da versão de uma conta só, para o app em cache no PWA: conta das tarefas (ou a primeira). */
  email: z.string().nullable(),
  tasksSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type GoogleStatusResponse = z.infer<typeof googleStatusResponseSchema>;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (#RRGGBB).');

export const updateGoogleCalendarsBodySchema = z.object({
  selectedIds: z.array(idSchema),
  defaultCalendarId: idSchema.nullable(),
  /** Cor por calendário; null volta para a do Google. Calendário fora do mapa fica como está. */
  colors: z.record(idSchema, hexColorSchema.nullable()).optional(),
});
export type UpdateGoogleCalendarsBody = z.infer<typeof updateGoogleCalendarsBodySchema>;

export const updateGoogleTasksAccountBodySchema = z.object({
  accountId: idSchema.nullable(),
});
export type UpdateGoogleTasksAccountBody = z.infer<typeof updateGoogleTasksAccountBodySchema>;
