import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';

function base64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/** No iPhone o Web Push só existe no app instalado na Tela de Início (iOS 16.4+). */
export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

export function usePush() {
  const key = useQuery({
    queryKey: ['push', 'key'],
    queryFn: () => api.get('push/public-key').json<{ publicKey: string | null }>(),
    staleTime: Infinity,
  });
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return;
    navigator.serviceWorker.getRegistration().then(async (registration) => {
      setSubscribed(Boolean(await registration?.pushManager.getSubscription()));
    });
  }, []);

  const enable = useCallback(async () => {
    if (!key.data?.publicKey)
      throw new Error('As notificações não estão configuradas no servidor.');
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted')
        throw new Error('Permita as notificações nos ajustes do navegador.');
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(key.data.publicKey),
        }));
      const json = subscription.toJSON();
      await api.post('push/subscriptions', {
        json: {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        },
      });
      setSubscribed(true);
    } finally {
      setBusy(false);
    }
  }, [key.data]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api.delete('push/subscriptions', { json: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, []);

  const test = useCallback(() => api.post('push/test').json<{ delivered: number }>(), []);

  return {
    supported: pushSupported(),
    configured: Boolean(key.data?.publicKey),
    subscribed,
    busy,
    enable,
    disable,
    test,
  };
}
