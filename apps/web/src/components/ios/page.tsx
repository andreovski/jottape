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
      <div className='pt-safe sticky top-0 z-30 pb-4'>
        {/* Faixa do topo: no início da página só os botões; ao rolar, a barra sólida aparece. */}
        <div
          aria-hidden
          className={cn(
            'top-scrim absolute inset-0 transition-opacity duration-200',
            compact && 'opacity-0'
          )}
        />
        <div
          aria-hidden
          className={cn(
            'bg-bar hairline-b absolute inset-x-0 top-0 bottom-4 transition-opacity duration-200',
            !compact && 'opacity-0'
          )}
        />
        <div className='relative mx-auto flex h-12 max-w-3xl items-center gap-2 px-4 lg:px-8'>
          {leading}
          <div
            className={cn(
              'text-headline min-w-0 flex-1 truncate transition-opacity duration-200',
              compact ? 'opacity-100' : 'opacity-0'
            )}
            aria-hidden={!compact}
          >
            {title}
          </div>
          <div className='text-tint ml-auto flex items-center justify-end gap-1'>{actions}</div>
        </div>
        {accessory && compact && (
          <div className='relative mx-auto max-w-3xl px-4 pb-2 lg:px-8'>{accessory}</div>
        )}
      </div>

      <div className='mx-auto max-w-3xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-12'>
        <header className='-mt-3 pt-1 pb-3'>
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
        'text-tint bg-bar bar-shadow inline-flex size-10 items-center justify-center rounded-full transition-opacity active:opacity-40 [&_svg]:size-[20px]',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
