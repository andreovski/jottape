import type { PushPayload } from '@jottape/schemas';
import webpush from 'web-push';

import { getVapidConfig } from '@/lib/env';
import { prisma } from '@/lib/prisma';

let configured = false;

function ensureConfigured(): boolean {
  const vapid = getVapidConfig();
  if (!vapid) return false;
  if (!configured) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    configured = true;
  }
  return true;
}

/** Manda a notificação para todos os aparelhos do usuário. Inscrição expirada (404/410) é apagada. */
export async function sendPush(userId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  let delivered = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          { TTL: 60 * 60 }
        );
        delivered++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription
            .delete({ where: { id: subscription.id } })
            .catch(() => undefined);
        } else {
          console.error('[push]', error);
        }
      }
    })
  );
  return delivered;
}
