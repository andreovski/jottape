import { addDays } from '@jottape/finance-engine';
import type { BriefingEvent, BriefingItem, BriefingResponse } from '@jottape/schemas';
import { Link, useRouter } from '@tanstack/react-router';
import {
  ChevronRight,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  Moon,
  Snowflake,
  Sun,
  Sunrise,
  Sunset,
  WandSparkles,
  X,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';

import { Skeleton } from '@/components/ios/controls';
import { useBriefing } from '@/features/briefing';
import { longDay, monthName, shortDay, time, todayKey } from '@/lib/format';
import { cn } from '@/lib/utils';

import { AmbientCanvas, isAmbient } from './ambient-canvas';
import { briefingCatalog } from './briefing-catalog';
import { RainCanvas } from './rain-canvas';
import {
  groupMoments,
  highlights,
  type MomentKey,
  skyGradient,
  type SkyKind,
  type SkyTheme,
  skyTheme,
} from './sky';
import { STOCK_PERIOD_LABELS, StockList } from './stock-chart';

/** Troca `{0}`, `{1}`... pelos valores formatados (ou ocultos). */
export function fillValues(text: string, values: number[], format: (cents: number) => string) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{(\d+)\}/g)) {
    parts.push(text.slice(last, match.index));
    const value = values[Number(match[1])];
    parts.push(
      <span key={match.index} className='numeric font-semibold whitespace-nowrap'>
        {value === undefined ? '' : format(value)}
      </span>
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

function Filled({ item, format }: { item: BriefingItem; format: (cents: number) => string }) {
  return (
    <>
      {fillValues(item.text, item.values, format).map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}

/**
 * Os compromissos do dia, um por linha: horário (ou "dia todo") e título. `limit` corta a lista
 * e mostra "+N"; os que já passaram ficam apagados.
 */
export function EventList({
  events,
  limit,
  className,
}: {
  events: BriefingEvent[];
  limit?: number;
  className?: string;
}) {
  if (events.length === 0) return null;
  const shown = limit === undefined ? events : events.slice(0, limit);
  const rest = events.length - shown.length;
  return (
    <ul className={cn('space-y-0.5', className)}>
      {shown.map((event, index) => (
        <li
          key={index}
          className={cn('flex min-w-0 gap-2', event.status === 'past' && 'text-white/55')}
        >
          <span className='numeric w-[4.2em] shrink-0 font-semibold'>
            {event.status === 'now' ? 'agora' : (event.time ?? 'dia todo')}
          </span>
          <span className='truncate'>{event.title}</span>
        </li>
      ))}
      {rest > 0 && <li className='text-white/70'>+{rest}</li>}
    </ul>
  );
}

const SKY_ICONS: Record<SkyKind, ReactNode> = {
  'clear-day': <Sun />,
  'clear-night': <Moon />,
  'cloudy-day': <Cloud />,
  'cloudy-night': <Cloud />,
  'rain-day': <CloudRain />,
  'rain-night': <CloudRain />,
  storm: <CloudLightning />,
  fog: <CloudFog />,
  snow: <Snowflake />,
  dawn: <Sunrise />,
  dusk: <Sunset />,
};

/** Gradiente do céu, com o brilho do sol ou da lua e chuva caindo quando chove. */
function SkyBackdrop({
  theme,
  className,
  glass,
}: {
  theme: SkyTheme;
  className?: string;
  /** Tela cheia: gotas paradas no vidro e estrelas cadentes maiores. */
  glass?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none overflow-hidden', className)}
      style={{ backgroundImage: skyGradient(theme) }}
    >
      {theme.glow !== 'none' && (
        <div
          className={cn(
            'absolute -top-24 -right-20 size-72 rounded-full blur-3xl motion-safe:animate-[sky-drift_14s_ease-in-out_infinite_alternate]',
            theme.glow === 'sun' ? 'bg-[#FFE29A]/45' : 'bg-[#C9D6FF]/25'
          )}
        />
      )}
      <div className='absolute -bottom-32 -left-24 size-80 rounded-full bg-white/10 blur-3xl' />
      {theme.intensity && <RainCanvas intensity={theme.intensity} glass={glass} />}
      {isAmbient(theme.kind) && <AmbientCanvas kind={theme.kind} big={glass} />}
    </div>
  );
}

function useSkyTheme(data: BriefingResponse | undefined) {
  return skyTheme(data?.sky ?? null, new Date().getHours());
}

// ---------------------------------------------------------------- linha do tempo

function momentLabels(key: MomentKey, today: string): { title: string; stamp: string } {
  switch (key) {
    case 'ontem':
      return { title: 'Ontem', stamp: shortDay(addDays(today, -1)) };
    case 'agora':
      return { title: 'Agora', stamp: time(new Date()) };
    case 'hoje':
      return { title: 'Hoje', stamp: shortDay(today) };
    case 'semana':
      return { title: 'Esta semana', stamp: `até ${shortDay(addDays(today, 6))}` };
    case 'mes':
      return { title: 'Este mês', stamp: monthName(today.slice(0, 7)) };
    case 'adiante':
      return { title: 'Mais adiante', stamp: 'próximas semanas' };
    case 'fim':
      return { title: 'Para levar', stamp: 'ditado do dia' };
  }
}

/** Entra subindo quando aparece na tela (uma vez só). */
function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={cn(
        'motion-safe:transition-[opacity,translate] motion-safe:duration-700 motion-safe:ease-out',
        !visible && 'motion-safe:translate-y-6 motion-safe:opacity-0',
        className
      )}
    >
      {children}
    </div>
  );
}

function TimelineItem({
  item,
  format,
  onOpen,
}: {
  item: BriefingItem;
  format: (cents: number) => string;
  onOpen: (href: string) => void;
}) {
  const info = briefingCatalog[item.plugin];
  const body = (
    <div
      className={cn(
        'rounded-[20px] bg-white/14 p-4 text-left ring-1 ring-white/20 backdrop-blur-md',
        item.tone === 'bad' && 'bg-[#FF453A]/25 ring-[#FF8A80]/40',
        item.tone === 'warning' && 'bg-[#FF9F0A]/20 ring-[#FFC266]/35'
      )}
    >
      <div className='text-caption mb-1 flex items-center justify-between font-semibold tracking-wide text-white/70 uppercase'>
        <span>
          {info.name}
          {item.stocks?.[0] && (
            <span className='font-medium tracking-normal normal-case'>
              {' · '}
              {STOCK_PERIOD_LABELS[item.stocks[0].period]}
            </span>
          )}
        </span>
        {item.href && <ChevronRight className='size-4 text-white/50' />}
      </div>
      {item.stocks?.length ? (
        <StockList stocks={item.stocks} />
      ) : (
        <p className='text-[19px] leading-[1.35] font-medium text-white'>
          <Filled item={item} format={format} />
        </p>
      )}
      {item.events && (
        <EventList
          events={item.events}
          className='text-subhead mt-3 border-t border-white/20 pt-3 text-white'
        />
      )}
    </div>
  );
  const href = item.href;
  return (
    <Reveal className='relative pl-14'>
      <span
        className='absolute top-3 left-[13px] flex size-[30px] items-center justify-center rounded-full text-white shadow-[0_0_0_4px_rgb(255_255_255/0.18)] [&_svg]:size-[15px]'
        style={{ backgroundColor: info.color }}
      >
        {info.icon}
      </span>
      {href ? (
        <button
          type='button'
          className='block w-full active:scale-[0.98] motion-safe:transition-transform'
          onClick={() => onOpen(href)}
        >
          {body}
        </button>
      ) : (
        body
      )}
    </Reveal>
  );
}

function BriefingStory({
  data,
  theme,
  format,
  onClose,
}: {
  data: BriefingResponse;
  theme: SkyTheme;
  format: (cents: number) => string;
  onClose: (href?: string) => void;
}) {
  const today = todayKey();
  const moments = groupMoments(data.items, data.autoOrder);
  const scroller = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLDivElement>(null);

  // A linha da timeline vai se preenchendo conforme a rolagem.
  function onScroll() {
    const element = scroller.current;
    const bar = progress.current;
    if (!element || !bar) return;
    const max = element.scrollHeight - element.clientHeight;
    const ratio = max <= 0 ? 1 : Math.min(1, element.scrollTop / max);
    bar.style.transform = `scaleY(${Math.max(0.04, ratio)})`;
  }
  useEffect(onScroll, [data]);

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className='absolute inset-0 overflow-y-auto overscroll-contain'
    >
      <SkyBackdrop theme={theme} className='fixed inset-0' glass />

      <div className='pt-safe sticky top-0 z-10 flex justify-end px-4 pb-2'>
        {/* Vidro que some para baixo: o texto que passa por trás do "fechar" desfoca. */}
        <div className='absolute inset-x-0 top-0 -bottom-6 bg-black/10 backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_55%,transparent)]' />
        <Dialog.Close
          aria-label='Fechar'
          className='relative mt-2 flex size-9 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-md active:opacity-60'
        >
          <X className='size-5' strokeWidth={2.4} />
        </Dialog.Close>
      </div>

      <div className='relative mx-auto max-w-xl px-5 pb-[calc(3rem+env(safe-area-inset-bottom))] text-white'>
        <header className='mb-10'>
          <div className='text-footnote font-semibold text-white/75 uppercase'>
            {longDay(today)}
          </div>
          <Dialog.Title className='font-rounded mt-1 text-[40px] leading-[1.05] font-bold'>
            Seu briefing
          </Dialog.Title>
          <Dialog.Description className='text-callout mt-2 text-white/80'>
            {data.items.length === 1 ? '1 destaque' : `${data.items.length} destaques`},{' '}
            {data.autoOrder
              ? 'do que passou ao que vem pela frente.'
              : 'na ordem que você escolheu.'}
          </Dialog.Description>
          {data.sky && (
            <div className='mt-5 flex items-center gap-3'>
              <span className='[&_svg]:size-9'>{SKY_ICONS[theme.kind]}</span>
              <span className='font-rounded numeric text-[44px] leading-none font-semibold'>
                {Math.round(data.sky.temperature)}°
              </span>
            </div>
          )}
        </header>

        <div className='relative'>
          {/* Trilho da linha do tempo e o preenchimento conforme a rolagem. */}
          <div className='absolute top-2 bottom-2 left-[27px] w-[2px] rounded-full bg-white/20' />
          <div
            ref={progress}
            className='absolute top-2 bottom-2 left-[27px] w-[2px] origin-top rounded-full bg-white/85 transition-transform duration-150'
            style={{ transform: 'scaleY(0.04)' }}
          />

          {moments.map((moment, momentIndex) => {
            const label = momentLabels(moment.key, today);
            return (
              <section key={`${moment.key}-${momentIndex}`} className='mb-9'>
                <Reveal className='relative mb-4 pl-14'>
                  <span className='absolute top-[22px] left-[21px] size-[14px] rounded-full border-[3px] border-white bg-white/30' />
                  <div className='text-caption font-semibold tracking-wider text-white/65 uppercase'>
                    {label.stamp}
                  </div>
                  <h3 className='font-rounded text-[30px] leading-tight font-bold'>
                    {label.title}
                  </h3>
                </Reveal>
                <div className='space-y-3'>
                  {moment.items.map((item, index) => (
                    <TimelineItem
                      key={`${item.plugin}-${index}`}
                      item={item}
                      format={format}
                      onOpen={(href) => onClose(href)}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          <Reveal className='relative pl-14'>
            <span className='absolute top-1 left-[21px] size-[14px] rounded-full bg-white' />
            <p className='text-subhead text-white/75'>Fim do briefing.</p>
            <Link
              to='/ajustes/briefing'
              onClick={() => onClose()}
              className='text-subhead mt-3 inline-flex rounded-full bg-white/18 px-4 py-2 font-semibold text-white ring-1 ring-white/25 backdrop-blur-md active:opacity-60'
            >
              Personalizar briefing
            </Link>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- card da tela Hoje

/**
 * Briefing fechado: um card com o céu de agora e o resumo do dia. Tocando, abre a linha do
 * tempo completa em tela cheia.
 */
const HIGHLIGHT_KEY = 'jottape:briefing-destaque';
const HIGHLIGHT_INTERVAL = 7000;

/** O destaque visto por último, para a próxima visita começar no seguinte. */
function readLast() {
  try {
    const last = Number(localStorage.getItem(HIGHLIGHT_KEY));
    return Number.isInteger(last) ? last : -1;
  } catch {
    return -1;
  }
}

/**
 * Os destaques do card fechado, um de cada vez, começando no seguinte ao da última visita. Troca
 * sozinho a cada 7 s (parado para quem pede menos movimento). Todos ficam empilhados na mesma
 * célula, então o card tem a altura do maior e não pula na troca.
 */
function HighlightSlides({
  items,
  format,
}: {
  items: BriefingItem[];
  format: (cents: number) => string;
}) {
  const count = items.length;
  const [index, setIndex] = useState(() => readLast() + 1);
  const current = index % count;

  // Conta como visto depois de um segundo na tela: montar e desmontar na hora não avança.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(HIGHLIGHT_KEY, String(current));
      } catch {
        // Sem armazenamento (aba privada): só não lembra.
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [current]);

  useEffect(() => {
    if (count < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), HIGHLIGHT_INTERVAL);
    return () => window.clearInterval(timer);
  }, [count]);

  return (
    <>
      <div className='grid'>
        {items.map((item, i) => {
          // No card fechado, só os compromissos que ainda vêm (até 3); a timeline mostra o dia todo.
          const upcoming = item.events?.filter((event) => event.status !== 'past') ?? [];
          return (
            <div
              key={`${item.plugin}-${i}`}
              aria-hidden={i !== current}
              className={cn(
                '[grid-area:1/1] motion-safe:transition-opacity motion-safe:duration-500',
                i === current ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <div className='text-footnote flex items-center gap-1 font-semibold text-white/80'>
                {item.plugin === 'insights' && (
                  <WandSparkles className='size-3.5' aria-label='Insight de IA' />
                )}
                Briefing · {briefingCatalog[item.plugin].name}
              </div>
              <p className='text-headline mt-1 line-clamp-3 font-semibold'>
                <Filled item={item} format={format} />
              </p>
              <EventList events={upcoming} limit={3} className='text-subhead mt-2 text-white/90' />
            </div>
          );
        })}
      </div>
      {count > 1 && (
        <div className='mt-3 flex gap-1.5' aria-hidden>
          {items.map((item, i) => (
            <span
              key={`${item.plugin}-${i}`}
              className={cn(
                'h-1.5 rounded-full bg-white/45 motion-safe:transition-all',
                i === current ? 'w-4 bg-white' : 'w-1.5'
              )}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function BriefingCard({ format }: { format: (cents: number) => string }) {
  const briefing = useBriefing();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const theme = useSkyTheme(briefing.data);

  if (briefing.isError) return null;
  if (briefing.isPending) return <Skeleton className='mb-7 h-[132px] rounded-[22px]' />;

  // Plugin que este app ainda não conhece (a API foi atualizada antes do app no aparelho) fica de fora.
  const data = {
    ...briefing.data,
    items: briefing.data.items.filter((item) => item.plugin in briefingCatalog),
  };
  if (data.items.length === 0) {
    return (
      <Link
        to='/ajustes/briefing'
        className='bg-surface text-subhead text-label-2 mb-7 block rounded-[22px] p-4 active:opacity-60'
      >
        Nada no briefing hoje. <span className='text-tint'>Escolher plugins</span>
      </Link>
    );
  }

  function close(href?: string) {
    setOpen(false);
    if (href) router.history.push(href);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type='button'
          className='font-briefing relative mb-7 block w-full overflow-hidden rounded-[22px] text-left text-white shadow-[0_10px_30px_-12px_rgb(0_0_0/0.35)] active:scale-[0.985] motion-safe:transition-transform'
        >
          <SkyBackdrop theme={theme} className='absolute inset-0' />
          <div className='relative flex min-h-[132px] gap-4 p-4'>
            <div className='flex min-w-0 flex-1 flex-col'>
              <HighlightSlides items={highlights(data.items)} format={format} />
              <div className='text-footnote mt-auto flex items-center gap-1 pt-2 text-white/75'>
                {data.items.length === 1 ? '1 destaque' : `${data.items.length} destaques`}
                <ChevronRight className='size-4' />
              </div>
            </div>
            <div className='flex shrink-0 flex-col items-end'>
              <span className='[&_svg]:size-7'>{SKY_ICONS[theme.kind]}</span>
              {data.sky && (
                <span className='font-rounded numeric mt-1 text-[28px] leading-none font-semibold'>
                  {Math.round(data.sky.temperature)}°
                </span>
              )}
            </div>
          </div>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content className='font-briefing fixed inset-0 z-50 bg-black outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'>
          <BriefingStory data={data} theme={theme} format={format} onClose={close} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
