import { useSyncExternalStore } from 'react';

// "Modo dev" dos Ajustes: mostra os passos e o custo de cada resposta do Assistente. Vale para o
// aparelho (localStorage); o servidor só manda os passos para o dono do app.
const KEY = 'jottape:dev-mode';

const listeners = new Set<() => void>();
let memory: boolean | null = null;

function read() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setDevMode(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Sem armazenamento (aba privada): vale só até recarregar.
  }
  memory = on;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  if (memory === null) memory = read();
  return memory;
}

export function useDevMode() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
