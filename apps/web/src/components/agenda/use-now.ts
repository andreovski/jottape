import { useSyncExternalStore } from 'react';

// Um relógio só para a tela toda, que anda de minuto em minuto (a linha vermelha do "agora").
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((notify) => notify());
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Instante atual (ms), atualizado a cada 30 s. */
export function useNow() {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => now
  );
}
