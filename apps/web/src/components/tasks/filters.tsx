import type { TaskListResponse } from '@jottape/schemas';
import { Check, Cloud, ListFilter, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Skeleton } from '@/components/ios/controls';
import { IconChip, Row, Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import { ListIcon, SmartViewIcon } from '@/components/tasks/icons';
import { listColor, SMART_VIEWS, sortLists } from '@/components/tasks/task-logic';
import { useTags, useTasks } from '@/features/tasks';
import { todayKey } from '@/lib/format';
import { cn } from '@/lib/utils';

/** O filtro da tela Tarefas: uma lista inteligente ou uma lista (id), e talvez uma etiqueta. */
export interface TaskFilter {
  filtro: string;
  tag?: string;
}

/** Quantos lembretes abertos há em cada lista inteligente (Concluídas não tem número). */
export function useSmartCounts(lists: TaskListResponse[] | undefined) {
  const today = useTasks({ view: 'today' });
  const next7 = useTasks({ view: 'next7' });
  const overdue = useTasks({ view: 'overdue' });
  const nodate = useTasks({ view: 'nodate' });
  const counts: Record<string, number | undefined> = {
    hoje: today.data?.length,
    programadas: next7.data?.length,
    atrasadas: overdue.data?.length,
    'sem-prazo': nodate.data?.length,
    todas: lists?.reduce((sum, list) => sum + list.openCount, 0),
  };
  return counts;
}

interface FilterOption {
  key: string;
  title: string;
  color: string;
  count?: number;
}

function filterOptions(
  lists: TaskListResponse[] | undefined,
  counts: Record<string, number | undefined>
): FilterOption[] {
  // "Todas" (o filtro padrão) vem primeiro; depois as outras listas inteligentes e as listas.
  const smart = [...SMART_VIEWS].sort(
    (a, b) => Number(b.slug === 'todas') - Number(a.slug === 'todas')
  );
  return [
    ...smart.map((meta) => ({
      key: meta.slug,
      title: meta.title,
      color: meta.color,
      count: counts[meta.slug],
    })),
    ...sortLists(lists ?? []).map((list) => ({
      key: list.id,
      title: list.name,
      color: listColor(list),
      count: list.openCount,
    })),
  ];
}

/**
 * Faixa de filtros no topo da tela: o botão que abre todos os filtros, a etiqueta escolhida (com
 * "x") e as listas inteligentes e as listas como pílulas que rolam para o lado.
 */
export function FilterBar({
  value,
  lists,
  counts,
  onChange,
  onOpenSheet,
}: {
  value: TaskFilter;
  lists: TaskListResponse[] | undefined;
  counts: Record<string, number | undefined>;
  onChange: (next: TaskFilter) => void;
  onOpenSheet: () => void;
}) {
  const options = filterOptions(lists, counts);
  const strip = useRef<HTMLDivElement>(null);

  // A pílula escolhida (ex.: vindo da folha) fica à vista na faixa.
  useEffect(() => {
    const chip = strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    chip?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [value.filtro, lists]);

  return (
    <div className='mb-4 flex items-center gap-2'>
      <button
        type='button'
        aria-label='Filtros'
        title='Filtros'
        onClick={onOpenSheet}
        className='bg-fill text-tint flex size-8 shrink-0 items-center justify-center rounded-full active:opacity-60'
      >
        <ListFilter className='size-[18px]' strokeWidth={2.25} />
      </button>
      <div
        ref={strip}
        className='-mr-4 flex min-w-0 flex-1 gap-2 overflow-x-auto pr-4 [scrollbar-width:none] lg:-mr-8 lg:pr-8 [&::-webkit-scrollbar]:hidden'
      >
        {value.tag && (
          <button
            type='button'
            onClick={() => onChange({ filtro: value.filtro })}
            aria-label={`Tirar a etiqueta ${value.tag}`}
            className='bg-tint text-subhead inline-flex h-8 shrink-0 items-center gap-1 rounded-full pr-2 pl-3 font-semibold text-white active:opacity-70'
          >
            #{value.tag}
            <X className='size-3.5' strokeWidth={3} />
          </button>
        )}
        {options.map((option) => {
          const selected = option.key === value.filtro;
          return (
            <button
              key={option.key}
              type='button'
              aria-pressed={selected}
              onClick={() => onChange({ filtro: option.key, tag: value.tag })}
              className={cn(
                'text-subhead inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 font-semibold transition-colors active:opacity-60',
                selected ? 'text-white' : 'bg-fill text-label'
              )}
              style={selected ? { backgroundColor: option.color } : undefined}
            >
              {!selected && (
                <span className='size-2 rounded-full' style={{ backgroundColor: option.color }} />
              )}
              {option.title}
              {option.count !== undefined && option.count > 0 && (
                <span
                  className={cn(
                    'font-rounded numeric text-footnote',
                    selected ? 'text-white/80' : 'text-label-2'
                  )}
                >
                  {option.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Todos os filtros numa folha: listas inteligentes em quadrados, listas e etiquetas. */
export function FilterSheet({
  open,
  onOpenChange,
  ...props
}: FilterPanelProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title='Filtrar' cancelLabel='Fechar'>
      <FilterPanel
        {...props}
        onChange={(next) => {
          props.onChange(next);
          onOpenChange(false);
        }}
      />
    </Sheet>
  );
}

interface FilterPanelProps {
  value: TaskFilter;
  lists: TaskListResponse[] | undefined;
  counts: Record<string, number | undefined>;
  onChange: (next: TaskFilter) => void;
  onNewList: () => void;
}

/**
 * O conteúdo dos filtros: dentro da folha no celular e, na tela larga, sempre à vista numa coluna
 * à esquerda (como a barra lateral do Lembretes no Mac).
 */
export function FilterPanel({ value, lists, counts, onChange, onNewList }: FilterPanelProps) {
  const tags = useTags();
  const day = Number(todayKey().slice(8, 10));
  const pick = onChange;

  return (
    <>
      <div className='mb-7 grid grid-cols-2 gap-3'>
        {SMART_VIEWS.map((meta) => {
          const selected = !value.tag && value.filtro === meta.slug;
          const count = counts[meta.slug];
          return (
            <button
              key={meta.slug}
              type='button'
              aria-pressed={selected}
              onClick={() => pick({ filtro: meta.slug })}
              className={cn(
                'bg-surface flex h-[76px] flex-col justify-between rounded-[12px] px-3 pt-2.5 pb-2 text-left transition-transform duration-100 active:scale-[0.97]',
                selected && 'ring-2 ring-[var(--ring-color)]'
              )}
              style={{ '--ring-color': meta.color } as React.CSSProperties}
            >
              <div className='flex items-start justify-between'>
                <span
                  className='flex size-[30px] items-center justify-center rounded-full text-white [&_svg]:size-[17px]'
                  style={{ backgroundColor: meta.color }}
                >
                  <SmartViewIcon icon={meta.icon} day={day} />
                </span>
                {meta.slug !== 'concluidas' &&
                  (count === undefined ? (
                    <Skeleton className='mt-1 h-5 w-6 rounded-md' />
                  ) : (
                    <span className='font-rounded numeric text-[24px] leading-[28px] font-bold'>
                      {count}
                    </span>
                  ))}
              </div>
              <span className='text-label-2 text-[15px] leading-5 font-semibold tracking-tight'>
                {meta.title}
              </span>
            </button>
          );
        })}
      </div>

      <Section header='Minhas listas'>
        {sortLists(lists ?? []).map((list) => (
          <Row
            key={list.id}
            onClick={() => pick({ filtro: list.id })}
            leading={
              <IconChip color={listColor(list)} round>
                <ListIcon icon={list.icon} inbox={list.isInbox} />
              </IconChip>
            }
            title={
              <span className='flex items-center gap-1.5'>
                <span className='truncate'>{list.name}</span>
                {list.googleLinked && (
                  <Cloud
                    className='text-label-3 size-3.5 shrink-0'
                    strokeWidth={2.25}
                    aria-label='Sincronizada com o Google'
                  />
                )}
              </span>
            }
            detail={list.openCount || ''}
            trailing={
              !value.tag && value.filtro === list.id ? (
                <Check className='text-tint size-[18px] shrink-0' strokeWidth={2.75} />
              ) : undefined
            }
          />
        ))}
        <Row action title='Adicionar Lista' onClick={onNewList} />
      </Section>

      {(tags.data?.length ?? 0) > 0 && (
        <Section header='Etiquetas'>
          <div className='flex flex-wrap gap-2 p-3'>
            {tags.data?.map((tag) => {
              const selected = value.tag === tag.name;
              return (
                <button
                  key={tag.id}
                  type='button'
                  aria-pressed={selected}
                  onClick={() =>
                    pick({ filtro: value.filtro, tag: selected ? undefined : tag.name })
                  }
                  className={cn(
                    'text-subhead inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium active:opacity-60',
                    selected ? 'bg-tint text-white' : 'bg-fill'
                  )}
                >
                  <span>#{tag.name}</span>
                  {tag.taskCount > 0 && (
                    <span
                      className={cn(
                        'font-rounded numeric text-footnote',
                        selected ? 'text-white/80' : 'text-label-2'
                      )}
                    >
                      {tag.taskCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Section>
      )}
    </>
  );
}
