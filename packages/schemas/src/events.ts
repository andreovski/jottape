import { z } from 'zod';

import { colorSchema, idSchema, isoDateTimeSchema, remindersSchema, rruleSchema } from './common';

/** "single": só esta ocorrência. "all": a série inteira. */
export const eventScopeSchema = z.enum(['single', 'all']);
export type EventScope = z.infer<typeof eventScopeSchema>;

const eventFields = {
  title: z.string().trim().min(1, 'Informe o título.').max(200),
  description: z.string().max(5000).nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  allDay: z.boolean().default(false),
  color: colorSchema,
  rrule: rruleSchema.nullable().optional(),
  reminders: remindersSchema.optional(),
  /** Calendário do Google (id do Jottape) onde o evento mora. Null = só no Jottape. */
  calendarId: idSchema.nullable().optional(),
};

const endAfterStart = (value: { startAt?: string; endAt?: string }) =>
  !value.startAt || !value.endAt || new Date(value.endAt) >= new Date(value.startAt);

export const createEventBodySchema = z
  .object(eventFields)
  .refine(endAfterStart, { path: ['endAt'], message: 'O fim precisa ser depois do início.' });
export type CreateEventBody = z.infer<typeof createEventBodySchema>;

export const updateEventBodySchema = z
  .object(eventFields)
  .partial()
  .extend({
    scope: eventScopeSchema.default('all'),
    /** Início original da ocorrência, obrigatório com scope "single" num evento recorrente. */
    occurrenceStart: isoDateTimeSchema.optional(),
  })
  .refine(endAfterStart, { path: ['endAt'], message: 'O fim precisa ser depois do início.' });
export type UpdateEventBody = z.infer<typeof updateEventBodySchema>;

export const deleteEventQuerySchema = z.object({
  scope: eventScopeSchema.default('all'),
  occurrenceStart: isoDateTimeSchema.optional(),
});
export type DeleteEventQuery = z.infer<typeof deleteEventQuerySchema>;

export const rangeQuerySchema = z
  .object({ from: isoDateTimeSchema, to: isoDateTimeSchema })
  .refine((v) => new Date(v.to) > new Date(v.from), { message: 'Intervalo inválido.' })
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 400 * 86_400_000, {
    message: 'Intervalo maior que 400 dias.',
  });
export type RangeQuery = z.infer<typeof rangeQuerySchema>;

/** Uma ocorrência na agenda (eventos recorrentes viram uma por dia em que acontecem). */
export const eventOccurrenceSchema = z.object({
  /** Id do evento mestre (ou do evento simples). É o id para editar e apagar. */
  eventId: z.string(),
  /** Início original da ocorrência: o que vai em occurrenceStart para mexer só nela. */
  occurrenceStart: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  allDay: z.boolean(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  color: z.string().nullable(),
  rrule: z.string().nullable(),
  isRecurring: z.boolean(),
  /** A ocorrência foi alterada sozinha (override). */
  isException: z.boolean(),
  source: z.enum(['LOCAL', 'GOOGLE']),
  calendarId: z.string().nullable(),
  reminders: z.array(z.number().int()),
});
export type EventOccurrence = z.infer<typeof eventOccurrenceSchema>;

export const eventResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string(),
  allDay: z.boolean(),
  color: z.string().nullable(),
  rrule: z.string().nullable(),
  source: z.enum(['LOCAL', 'GOOGLE']),
  calendarId: z.string().nullable(),
  reminders: z.array(z.number().int()),
  syncState: z.enum(['SYNCED', 'PENDING', 'ERROR']),
});
export type EventResponse = z.infer<typeof eventResponseSchema>;
