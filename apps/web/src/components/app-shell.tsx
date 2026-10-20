import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { CalendarDays, CircleCheck, Settings, Sun, Wallet } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

export const SECTIONS = [
  { to: '/', label: 'Hoje', icon: Sun, tint: 'var(--indigo)' },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, tint: 'var(--red)' },
  { to: '/tarefas', label: 'Tarefas', icon: CircleCheck, tint: 'var(--orange)' },
  { to: '/financas', label: 'Finanças', icon: Wallet, tint: 'var(--green)' },
  { to: '/ajustes', label: 'Ajustes', icon: Settings, tint: 'var(--blue)' },
] as const;

/** Abas do celular: Tarefas abre pela Hoje ("Ver todas") e não ocupa uma aba. */
const TABS = SECTIONS.filter((s) => s.to !== '/tarefas');

function sectionOf(pathname: string) {
  return (
    [...SECTIONS]
      .reverse()
      .find((s) => (s.to === '/' ? pathname === '/' : pathname.startsWith(s.to))) ?? SECTIONS[0]
  );
}

/**
 * Celular: abas translúcidas embaixo (UITabBar). Computador: barra lateral (como o app no iPad e no
 * Mac). A cor da seção aberta vira `--tint`, usada por botões, links e destaques.
 */
export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current = sectionOf(pathname);

  return (
    <div
      className='bg-background text-foreground min-h-dvh lg:flex'
      style={{ '--tint': current.tint } as CSSProperties}
    >
      <aside className='bg-surface/60 hairline-r sticky top-0 hidden h-dvh w-64 shrink-0 flex-col px-3 pt-6 lg:flex dark:bg-[#161617]'>
        <div className='mb-6 flex items-center gap-2.5 px-3'>
          <img src='/icons/icon-192.png' alt='' className='size-8 rounded-[8px]' />
          <span className='text-title-3'>Jottape</span>
        </div>
        <nav aria-label='Seções' className='flex flex-col gap-0.5'>
          {SECTIONS.map(({ to, label, icon: Icon, tint }) => {
            const active = current.to === to;
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'text-body flex items-center gap-3 rounded-[10px] px-3 py-2 transition-colors',
                  active ? 'bg-fill font-semibold' : 'hover:bg-fill/60'
                )}
              >
                <span
                  className='flex size-7 items-center justify-center rounded-[7px] text-white [&_svg]:size-4'
                  style={{ backgroundColor: tint }}
                >
                  <Icon strokeWidth={2.25} />
                </span>
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className='min-w-0 flex-1'>
        <Outlet />
      </main>

      <TabBar key={current.to} currentTo={current.to} />
    </div>
  );
}

/**
 * Compacta a barra ao rolar para baixo (mais de 24 px) e expande ao subir, ao chegar no topo ou
 * quando o chamador pede. Ignora o "quique" do iOS e rolagens de poucos pixels.
 */
function useCompactOnScroll() {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - last;
      if (Math.abs(delta) < 4) return;
      last = y;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (y <= 8 || y >= max - 2 || delta < 0) setCompact(false);
      else if (y > 24 && delta > 0) setCompact(true);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return [compact, setCompact] as const;
}

/** Fecha a barra quando o teclado abre, para ela não subir junto. */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setOpen(window.innerHeight - viewport.height > 120);
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);
  return open;
}

/**
 * Barra de abas do celular: cápsula flutuante de cor sólida (`--bar`, vem do tema) com a aba ativa
 * em pílula na cor da seção. Ao rolar para baixo ela encolhe (só ícones, 64% da largura).
 */
function TabBar({ currentTo }: { currentTo: string }) {
  const [compact, setCompact] = useCompactOnScroll();
  const keyboardOpen = useKeyboardOpen();

  return (
    <nav
      aria-label='Seções'
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] transition-transform duration-300 lg:hidden',
        keyboardOpen && 'translate-y-full'
      )}
    >
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[var(--background)] from-55% to-transparent'
      />
      <ul
        className={cn(
          'relative bg-bar bar-shadow pointer-events-auto flex max-w-xl items-stretch gap-0.5 rounded-full p-1 transition-[width,height] duration-[380ms] ease-[cubic-bezier(0.32,1.25,0.5,1)] motion-reduce:transition-none',
          compact ? 'h-10 w-[64%]' : 'h-14 w-full'
        )}
      >
        {TABS.map(({ to, label, icon: Icon }) => {
          const active = currentTo === to;
          return (
            <li key={to} className='min-w-0 flex-1'>
              <Link
                to={to}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  if (compact) {
                    event.preventDefault();
                    setCompact(false);
                  } else if (active) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
                className={cn(
                  'flex h-full flex-col items-center justify-center rounded-full text-[10px] font-medium transition-[background-color,color,transform] duration-200 active:scale-[0.94] motion-reduce:transition-none',
                  active ? 'text-tint bg-tint/15' : 'text-gray'
                )}
              >
                <Icon
                  className={cn(
                    'transition-[width,height]',
                    compact ? 'size-[18px]' : 'size-[22px]'
                  )}
                  strokeWidth={active ? 2.3 : 1.9}
                  aria-hidden
                />
                <span
                  className={cn(
                    'overflow-hidden transition-[max-height,opacity] duration-200 motion-reduce:transition-none',
                    compact ? 'max-h-0 opacity-0' : 'mt-0.5 max-h-3 opacity-100'
                  )}
                  aria-hidden
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
