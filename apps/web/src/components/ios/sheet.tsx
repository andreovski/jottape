import { type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { Drawer } from 'vaul';

import { cn } from '@/lib/utils';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  /** Botão da direita ("Adicionar", "OK"). */
  confirmLabel?: string;
  onConfirm?: () => void;
  /** Só enquanto salva: campos faltando não desabilitam, mostram o erro no campo (useFormErrors). */
  confirmDisabled?: boolean;
  cancelLabel?: string;
  /** Altura cheia (formulários longos). */
  tall?: boolean;
  /** Aberta por cima de outra folha: a de baixo recua, como no iOS. */
  nested?: boolean;
}

/**
 * Com o teclado aberto, o iOS empurra a página para cima e a folha (presa no fundo) fica com o topo
 * fora da tela: aparecia o fim do formulário em vez do campo tocado. Enquanto o teclado está aberto,
 * a folha passa a ocupar só a área visível (`visualViewport`), e o próprio conteúdo dela rola.
 */
function useFitVisibleArea(open: boolean, ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport) return;
    const reset = () => {
      const element = ref.current;
      if (!element) return;
      for (const key of ['top', 'bottom', 'height', 'maxHeight'] as const) element.style[key] = '';
    };
    const update = () => {
      const element = ref.current;
      if (!element) return;
      const keyboardOpen = window.innerHeight - viewport.height > 120;
      if (!keyboardOpen) return reset();
      element.style.top = `${viewport.offsetTop + 8}px`;
      element.style.bottom = 'auto';
      element.style.height = `${viewport.height - 8}px`;
      element.style.maxHeight = 'none';
    };
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    update();
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      reset();
    };
  }, [open, ref]);
}

/**
 * Folha que sobe de baixo, com a alça e a barra "Cancelar · Título · OK" do iOS. Arrastar para baixo
 * fecha. No computador vira uma folha centralizada de largura fixa (como no iPad).
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  onConfirm,
  confirmDisabled,
  cancelLabel = 'Cancelar',
  tall,
  nested,
}: SheetProps) {
  const Root = nested ? Drawer.NestedRoot : Drawer.Root;
  const content = useRef<HTMLDivElement>(null);
  useFitVisibleArea(open, content);
  return (
    <Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className='fixed inset-0 z-50 bg-black/40' />
        <Drawer.Content
          ref={content}
          aria-describedby={undefined}
          className={cn(
            'bg-background fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-lg flex-col rounded-t-[12px] outline-none',
            'lg:bottom-auto lg:top-1/2 lg:max-h-[85dvh] lg:-translate-y-1/2 lg:rounded-[14px] lg:shadow-2xl',
            tall ? 'h-[94dvh] lg:h-auto' : 'max-h-[94dvh]'
          )}
        >
          <div className='bg-label-3 mx-auto mt-[5px] h-[5px] w-9 shrink-0 rounded-full lg:hidden' />
          <div className='grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-4'>
            <button
              type='button'
              className='text-tint text-body justify-self-start active:opacity-40'
              onClick={() => onOpenChange(false)}
            >
              {cancelLabel}
            </button>
            <Drawer.Title className='text-headline truncate'>{title}</Drawer.Title>
            {confirmLabel ? (
              <button
                type='button'
                disabled={confirmDisabled}
                onClick={onConfirm}
                className='text-tint text-headline justify-self-end active:opacity-40 disabled:opacity-30'
              >
                {confirmLabel}
              </button>
            ) : (
              <span />
            )}
          </div>
          <div className='flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]'>
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Root>
  );
}

/** Menu de ações (UIAlertController .actionSheet): opções empilhadas e "Cancelar" separado. */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  message,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  message?: string;
  actions: { label: string; onSelect: () => void; destructive?: boolean }[];
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className='fixed inset-0 z-50 bg-black/40' />
        <Drawer.Content
          aria-describedby={undefined}
          className='fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] outline-none'
        >
          <div className='material overflow-hidden rounded-[14px] text-center'>
            {(title || message) && (
              <div className='hairline-b px-4 py-3'>
                <Drawer.Title className='text-footnote text-label-2 font-semibold'>
                  {title ?? ''}
                </Drawer.Title>
                {message && <p className='text-footnote text-label-2 mt-0.5'>{message}</p>}
              </div>
            )}
            {!title && !message && <Drawer.Title className='sr-only'>Opções</Drawer.Title>}
            {actions.map((action) => (
              <button
                key={action.label}
                type='button'
                className={cn(
                  'hairline-b active:bg-fill block h-[57px] w-full text-[20px] last:shadow-none',
                  action.destructive ? 'text-red' : 'text-tint'
                )}
                onClick={() => {
                  onOpenChange(false);
                  action.onSelect();
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
          <button
            type='button'
            className='bg-elevated text-tint active:bg-surface-2 mt-2 block h-[57px] w-full rounded-[14px] text-[20px] font-semibold'
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </button>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
