import { useSyncExternalStore } from 'react';

/** Os mesmos cortes do Tailwind: `lg:` (64rem, barra lateral) e `xl:` (80rem, duas colunas). */
export const DESKTOP_QUERY = '(min-width: 64rem)';
export const WIDE_QUERY = '(min-width: 80rem)';

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/**
 * Tela de computador (ou iPad deitado). Só para trocar o tipo de peça (folha que sobe de baixo ×
 * janela no centro); tamanho e posição continuam nas classes `lg:`.
 */
export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);

/**
 * Tela larga, com espaço para uma segunda coluna (painel de listas, carteira, mês ao lado do dia).
 * No celular a tela continua montada como sempre.
 */
export const useIsWide = () => useMediaQuery(WIDE_QUERY);
