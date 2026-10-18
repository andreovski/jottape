import { z } from 'zod';

import { idSchema } from './common';

export const googleCalendarResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  primary: z.boolean(),
  selected: z.boolean(),
  syncedAt: z.string().nullable(),
});
export type GoogleCalendarResponse = z.infer<typeof googleCalendarResponseSchema>;

export const googleStatusResponseSchema = z.object({
  /** O servidor tem GOOGLE_CLIENT_ID/SECRET configurados. */
  configured: z.boolean(),
  connected: z.boolean(),
  email: z.string().nullable(),
  calendars: z.array(googleCalendarResponseSchema),
  defaultCalendarId: z.string().nullable(),
  tasksSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type GoogleStatusResponse = z.infer<typeof googleStatusResponseSchema>;

export const updateGoogleCalendarsBodySchema = z.object({
  selectedIds: z.array(idSchema),
  defaultCalendarId: idSchema.nullable(),
});
export type UpdateGoogleCalendarsBody = z.infer<typeof updateGoogleCalendarsBodySchema>;
