import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { CalendarDays, CircleCheck, Settings, Sun, Wallet } from 'lucide-react';
import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

export const SECTIONS = [
  { to: '/', label: 'Hoje', icon: Sun, tint: 'var(--indigo)' },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, tint: 'var(--red)' },
  { to: '/tarefas', label: 'Tarefas', icon: CircleCheck, tint: 'var(--orange)' },
  { to: '/financas', label: 'Finanças', icon: Wallet, tint: 'var(--green)' },
  { to: '/ajustes', label: 'Ajustes', icon: Settings, tint: 'var(--blue)' },
] as const;

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

      <nav
        aria-label='Seções'
        className='material hairline-t pb-safe fixed inset-x-0 bottom-0 z-40 lg:hidden'
      >
        <ul className='mx-auto grid h-[50px] max-w-xl grid-cols-5'>
          {SECTIONS.map(({ to, label, icon: Icon }) => {
            const active = current.to === to;
            return (
              <li key={to}>
                <Link
                  to={to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-full flex-col items-center justify-center gap-[3px] text-[10px] font-medium tracking-normal transition-colors',
                    active ? 'text-tint' : 'text-gray'
                  )}
                >
                  <Icon className='size-[25px]' strokeWidth={active ? 2.4 : 1.9} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
