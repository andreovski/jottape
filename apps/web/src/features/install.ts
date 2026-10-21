import { useEffect, useState } from 'react';

import { isStandalone } from '@/features/push';

export type Platform = 'ios' | 'android';

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function detectPlatform(): Platform | null {
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOs) return 'ios';
  return /Android/i.test(ua) ? 'android' : null;
}

/**
 * O Chrome dispara `beforeinstallprompt` uma vez, logo ao carregar, antes de a tela Hoje existir:
 * guarda o evento no módulo para o convite e a página de instalação poderem usá-lo depois.
 */
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/** Evento de instalação nativa (só Chrome/Android) ou null; `install()` abre o diálogo do sistema. */
export function useInstallPrompt() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return {
    available: deferred !== null,
    async install() {
      const event = deferred;
      if (!event) return false;
      await event.prompt();
      const { outcome } = await event.userChoice;
      deferred = null;
      notify();
      return outcome === 'accepted';
    },
  };
}

const KEY = 'jottape:install-invite';
const SNOOZE_DAYS = 7;

interface Stored {
  never?: boolean;
  until?: number;
}

function read(): Stored {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored;
  } catch {
    return {};
  }
}

function write(value: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // sem localStorage: o convite só aparece de novo na próxima visita
  }
}

/** Celular no navegador (não instalado) que ainda não dispensou o convite. */
export function shouldInvite(now = Date.now()): boolean {
  if (!detectPlatform() || isStandalone()) return false;
  const stored = read();
  return !stored.never && (stored.until ?? 0) <= now;
}

export const snoozeInvite = (now = Date.now()) =>
  write({ until: now + SNOOZE_DAYS * 24 * 60 * 60 * 1000 });

export const dismissInviteForever = () => write({ never: true });
