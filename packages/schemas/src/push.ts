import { z } from 'zod';

export const pushPublicKeyResponseSchema = z.object({ publicKey: z.string().nullable() });
export type PushPublicKeyResponse = z.infer<typeof pushPublicKeyResponseSchema>;

export const pushSubscribeBodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type PushSubscribeBody = z.infer<typeof pushSubscribeBodySchema>;

export const pushUnsubscribeBodySchema = z.object({ endpoint: z.string().url() });

/** Formato da notificação que a API manda e o service worker mostra. */
export interface PushPayload {
  title: string;
  body: string;
  /** Rota do app que abre ao tocar (ex.: "/agenda"). */
  url: string;
  tag?: string;
}
