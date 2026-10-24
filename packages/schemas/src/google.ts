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
  /** Agenda por link (ICS): só de leitura, não pode ser a padrão nem receber eventos. */
  readOnly: z.boolean().default(false),
  syncedAt: z.string().nullable(),
  /** Ids do mesmo calendário do Google visto por outras contas conectadas. */
  alsoIn: z.array(z.string()),
});
export type GoogleCalendarResponse = z.infer<typeof googleCalendarResponseSchema>;

export const calendarProviderSchema = z.enum(['GOOGLE', 'MICROSOFT', 'ICS']);
export type CalendarProvider = z.infer<typeof calendarProviderSchema>;

/**
 * Conta de agenda conectada: Google, Microsoft (Outlook, Microsoft 365) ou uma agenda por link
 * (ICS). Na agenda por link, `email` é só o domínio do link: o link inteiro não volta para o app.
 */
export const googleAccountResponseSchema = z.object({
  id: z.string(),
  provider: calendarProviderSchema,
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
  /** O servidor tem MICROSOFT_CLIENT_ID/SECRET configurados. */
  microsoftConfigured: z.boolean(),
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

const icsUrlSchema = z
  .string()
  .trim()
  .min(1, 'Cole o link da agenda.')
  .max(2000, 'Link longo demais.');

/** Agenda por link: o link ICS/webcal publicado (ex.: Outlook › Publicar um calendário). */
export const addIcsCalendarBodySchema = z.object({
  url: icsUrlSchema,
  /** Sem nome, vale o do arquivo (X-WR-CALNAME). */
  name: z.string().trim().max(80).nullish(),
  color: hexColorSchema.nullish(),
});
export type AddIcsCalendarBody = z.infer<typeof addIcsCalendarBodySchema>;

export const updateIcsCalendarBodySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: icsUrlSchema.optional(),
});
export type UpdateIcsCalendarBody = z.infer<typeof updateIcsCalendarBodySchema>;
