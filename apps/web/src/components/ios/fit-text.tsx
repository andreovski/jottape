import { type ReactNode, useLayoutEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Uma linha que diminui a fonte para caber, em vez de cortar com "…" (como o
 * adjustsFontSizeToFitWidth do iOS). O tamanho base vem da className; a altura da linha não muda,
 * então o layout em volta fica parado. Abaixo de `minScale` para de diminuir e o fim fica escondido.
 */
export function FitText({
  children,
  className,
  minScale = 0.5,
}: {
  children: ReactNode;
  className?: string;
  minScale?: number;
}) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = outer.current;
    const text = inner.current;
    if (!box || !text) return;

    const fit = () => {
      // Mede no tamanho cheio; a escala é proporcional à largura (o espaçamento também é em em).
      text.style.fontSize = '';
      const natural = text.getBoundingClientRect().width;
      // Numa caixa que encolhe junto com o texto (item de flex sem largura fixa), diminuir a fonte
      // muda o espaço disponível: repete até a medida parar de mudar.
      for (let i = 0; i < 4; i++) {
        const available = box.getBoundingClientRect().width;
        if (available <= 0 || text.getBoundingClientRect().width <= available) break;
        const scale = Math.max(minScale, Math.floor(((available - 1) / natural) * 1000) / 1000);
        text.style.fontSize = `${scale}em`;
        if (scale === minScale) break;
      }
    };

    fit();
    let frame = 0;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            // No próximo quadro: evita o aviso de laço do ResizeObserver quando a caixa encolhe junto.
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(fit);
          });
    observer?.observe(box);
    // A fonte arredondada pode chegar depois e mudar a largura do texto.
    document.fonts?.ready.then(fit).catch(() => {});
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [children, minScale]);

  return (
    <span ref={outer} className={cn('block min-w-0 overflow-hidden whitespace-nowrap', className)}>
      <span ref={inner} className='inline-block'>
        {children}
      </span>
    </span>
  );
}
