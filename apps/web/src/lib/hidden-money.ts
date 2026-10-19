import { useSyncExternalStore } from 'react';

import { money } from './format';

// "Ocultar saldo" da tela Hoje: vale para o aparelho (localStorage), não para a conta.
const KEY = 'jottape:hide-money';
export const HIDDEN_MONEY = 'R$ ***';

const listeners = new Set<() => void>();
let memory: boolean | null = null;

function read() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setMoneyHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Sem armazenamento (aba privada): vale só até recarregar.
  }
  memory = hidden;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Outra aba mudou.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      memory = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function snapshot() {
  if (memory === null) memory = read();
  return memory;
}

/** Saldo oculto e o formatador que respeita a escolha. */
export function useHiddenMoney() {
  const hidden = useSyncExternalStore(subscribe, snapshot, () => false);
  return {
    hidden,
    toggle: () => setMoneyHidden(!hidden),
    format: (cents: number) => (hidden ? HIDDEN_MONEY : money(cents)),
  };
}
