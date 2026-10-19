import type { BriefingItem } from '@jottape/schemas';
import { Link, useRouter } from '@tanstack/react-router';
import { Fragment, type ReactNode } from 'react';

import { Skeleton } from '@/components/ios/controls';
import { IconChip } from '@/components/ios/list';
import { useBriefing } from '@/features/briefing';
import { cn } from '@/lib/utils';

import { briefingCatalog } from './briefing-catalog';

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

const toneClass: Record<BriefingItem['tone'], string> = {
  neutral: '',
  good: '',
  warning: 'text-orange',
  bad: 'text-red',
};

function ItemRow({ item, format }: { item: BriefingItem; format: (cents: number) => string }) {
  const router = useRouter();
  const info = briefingCatalog[item.plugin];
  const body = (
    <div className='flex gap-3 py-2.5'>
      <IconChip color={info.color} size='sm'>
        {info.icon}
      </IconChip>
      <p className={cn('text-subhead min-w-0 flex-1 pt-[2px]', toneClass[item.tone])}>
        {fillValues(item.text, item.values, format).map((part, index) => (
          <Fragment key={index}>{part}</Fragment>
        ))}
      </p>
    </div>
  );
  if (!item.href) return body;
  // `href` vem da API e pode ter busca (?tab=...): vai direto para o histórico do roteador.
  const href = item.href;
  return (
    <button
      type='button'
      onClick={() => router.history.push(href)}
      className='block w-full text-left active:opacity-60'
    >
      {body}
    </button>
  );
}

/** Briefing do dia: uma frase por plugin, na ordem escolhida em Ajustes. */
export function BriefingCard({ format }: { format: (cents: number) => string }) {
  const briefing = useBriefing();

  if (briefing.isError) return null;

  return (
    <section className='mb-7'>
      <div className='flex items-end justify-between px-4 pb-1.5'>
        <h2 className='text-footnote text-label-2 uppercase'>Briefing</h2>
        <Link to='/ajustes/briefing' className='text-subhead text-tint'>
          Editar
        </Link>
      </div>
      <div className='bg-surface rounded-[var(--radius)] px-4 py-1 [&>*:not(:last-child)]:shadow-[inset_0_-0.5px_0_var(--separator)]'>
        {briefing.isPending ? (
          <div className='space-y-3 py-2'>
            <Skeleton className='h-4' />
            <Skeleton className='h-4 w-4/5' />
            <Skeleton className='h-4 w-3/5' />
          </div>
        ) : briefing.data.items.length === 0 ? (
          <p className='text-subhead text-label-2 py-2'>
            Nada a destacar hoje.{' '}
            <Link to='/ajustes/briefing' className='text-tint'>
              Escolher plugins
            </Link>
          </p>
        ) : (
          briefing.data.items.map((item, index) => (
            <ItemRow key={`${item.plugin}-${index}`} item={item} format={format} />
          ))
        )}
      </div>
    </section>
  );
}
