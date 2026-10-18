import { useEffect, useState } from 'react';

/** O instante atual, renovado a cada minuto (para "atrasado" e "Hoje" não envelhecerem). */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * As folhas (vaul) vão para o `<body>`, fora do `--tint` da página. Enquanto a tela estiver aberta,
 * a cor dela também vale na raiz; ao sair, volta a que estava.
 */
export function useRootTint(color: string) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.getPropertyValue('--tint');
    root.style.setProperty('--tint', color);
    return () => {
      if (previous) root.style.setProperty('--tint', previous);
      else root.style.removeProperty('--tint');
    };
  }, [color]);
}

/** Estado de uma folha que monta de novo a cada abertura (o formulário começa limpo). */
export function useSheetState<T>(initial?: { value: T }) {
  const [state, setState] = useState<{ key: number; value: T } | null>(
    initial ? { key: 1, value: initial.value } : null
  );
  const [open, setOpen] = useState(Boolean(initial));
  return {
    open,
    setOpen,
    key: state?.key ?? 0,
    value: state?.value ?? null,
    show(value: T) {
      setState((current) => ({ key: (current?.key ?? 0) + 1, value }));
      setOpen(true);
    },
  };
}
