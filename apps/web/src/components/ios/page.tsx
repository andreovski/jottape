import { type ReactNode, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface PageProps {
  title: string;
  /** Linha pequena acima do título, na cor da seção (ex.: "SÁBADO, 18 DE OUTUBRO"). */
  eyebrow?: ReactNode;
  /** Linha logo abaixo do título grande (o status do Jotta). */
  subtitle?: ReactNode;
  /** Classes a mais do título, grande e pequeno (a fonte quadrada do Jotta). */
  titleClassName?: string;
  /** Botões do canto direito da barra (ícones na cor da seção). */
  actions?: ReactNode;
  /** Botão do canto esquerdo (voltar). */
  leading?: ReactNode;
  /** Conteúdo preso logo abaixo da barra (segmentos, busca). */
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * Coluna larga no computador (Hoje, Agenda, Tarefas): cabe uma segunda coluna ao lado. No
   * celular não muda nada.
   */
  wide?: boolean;
}

/**
 * Página no padrão do iOS: título grande que, ao rolar, vira o título pequeno de uma barra
 * translúcida presa no topo (UINavigationBar com prefersLargeTitles).
 */
export function Page({
  title,
  eyebrow,
  subtitle,
  titleClassName,
  actions,
  leading,
  accessory,
  children,
  className,
  wide,
}: PageProps) {
  const column = cn('mx-auto max-w-3xl px-4 lg:px-8', wide && 'lg:max-w-6xl');
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
        {/* Degradê do fundo da página: sem faixa sólida, o conteúdo some suave sob o título. */}
        <div aria-hidden className='top-scrim absolute inset-0' />
        <div className={cn(column, 'relative flex h-12 items-center gap-2')}>
          {leading}
          <div
            className={cn(
              'text-headline min-w-0 flex-1 truncate transition-opacity duration-200',
              compact ? 'opacity-100' : 'opacity-0',
              titleClassName
            )}
            aria-hidden={!compact}
          >
            {title}
          </div>
          <div className='text-tint ml-auto flex items-center justify-end gap-1'>{actions}</div>
        </div>
        {/* Preso sob a barra por cima do conteúdo, sem ocupar espaço: se a barra crescesse, a página
            andaria, o título voltaria à tela e a barra encolheria de novo, num pisca-pisca sem fim
            (a tela "tremendo"). O Safari não compensa a rolagem como o Chrome. */}
        {accessory && compact && (
          <div className='absolute inset-x-0 top-full -mt-4'>
            <div aria-hidden className='top-scrim absolute inset-x-0 top-0 -bottom-4' />
            <div className={cn(column, 'relative pb-2')}>{accessory}</div>
          </div>
        )}
      </div>

      <div className={cn(column, 'pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-12')}>
        <header className='-mt-3 pt-1 pb-3'>
          {eyebrow && (
            <div className='text-footnote text-tint font-semibold uppercase'>{eyebrow}</div>
          )}
          <h1 className={cn('text-large-title', titleClassName)}>{title}</h1>
          {subtitle}
          <div ref={sentinel} />
        </header>
        {/* Continua no lugar (invisível) enquanto está lá em cima, pelo mesmo motivo. */}
        {accessory && (
          <div className={cn('mb-4', compact && 'invisible')} inert={compact}>
            {accessory}
          </div>
        )}
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
