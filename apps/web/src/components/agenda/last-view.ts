const KEY = 'jottape:agenda:view';

/** A última visão aberta da agenda neste aparelho (null se nunca escolheu ou o storage falhar). */
export function loadLastView<T extends string>(isValid: (value: unknown) => value is T): T | null {
  try {
    const value = localStorage.getItem(KEY);
    return isValid(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveLastView(view: string) {
  try {
    localStorage.setItem(KEY, view);
  } catch {
    // Aba privada ou storage cheio: só não lembra.
  }
}
