import { type ReactNode, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface PageProps {
  title: string;
  /** Linha pequena acima do título, na cor da seção (ex.: "SÁBADO, 18 DE OUTUBRO"). */
  eyebrow?: ReactNode;
  /** Botões do canto direito da barra (ícones na cor da seção). */
  actions?: ReactNode;
  /** Botão do canto esquerdo (voltar). */
  leading?: ReactNode;
  /** Conteúdo preso logo abaixo da barra (segmentos, busca). */
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Página no padrão do iOS: título grande que, ao rolar, vira o título pequeno de uma barra
 * translúcida presa no topo (UINavigationBar com prefersLargeTitles).
 */
export function Page({
  title,
  eyebrow,
  actions,
  leading,
  accessory,
  children,
  className,
}: PageProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setCompact(!entry.isIntersecting), {
      rootMargin: '-52px 0px 0px 0px',
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn('min-h-full', className)}>
      <div
        className={cn(
          'pt-safe sticky top-0 z-30 transition-[background-color,box-shadow] duration-200',
          compact ? 'material hairline-b' : 'bg-background'
        )}
      >
        <div className='mx-auto grid h-11 max-w-3xl grid-cols-[1fr_auto_1fr] items-center px-4 lg:px-8'>
          <div className='flex min-w-0 items-center justify-start'>{leading}</div>
          <div
            className={cn(
              'text-headline truncate transition-opacity duration-200',
              compact ? 'opacity-100' : 'opacity-0'
            )}
            aria-hidden={!compact}
          >
            {title}
          </div>
          <div className='text-tint flex items-center justify-end gap-1'>{actions}</div>
        </div>
        {accessory && compact && (
          <div className='mx-auto max-w-3xl px-4 pb-2 lg:px-8'>{accessory}</div>
        )}
      </div>

      <div className='mx-auto max-w-3xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-12'>
        <header className='pt-1 pb-3'>
          {eyebrow && (
            <div className='text-footnote text-tint font-semibold uppercase'>{eyebrow}</div>
          )}
          <h1 className='text-large-title'>{title}</h1>
          <div ref={sentinel} />
        </header>
        {accessory && !compact && <div className='mb-4'>{accessory}</div>}
        {children}
      </div>
    </div>
  );
}

/** Botão redondo de ícone da barra (o "+" do iOS). */
export function BarButton({
  label,
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      className={cn(
        'text-tint inline-flex size-9 items-center justify-center rounded-full transition-opacity active:opacity-40 [&_svg]:size-[22px]',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
