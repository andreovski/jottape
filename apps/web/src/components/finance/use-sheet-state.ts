import { useState } from 'react';

/**
 * Estado de uma folha que mostra um item. O item fica guardado depois de fechar, para a folha
 * descer com o conteúdo em vez de esvaziar no meio da animação.
 */
export function useSheetState<T>() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<T | undefined>(undefined);
  return {
    open,
    value,
    show: (next?: T) => {
      setValue(next);
      setOpen(true);
    },
    onOpenChange: setOpen,
  };
}
