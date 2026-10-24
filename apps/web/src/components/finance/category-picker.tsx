import type { CategoryResponse, TransactionKind } from '@jottape/schemas';
import { Ban, Check } from 'lucide-react';
import { useState } from 'react';

import { IconChip, Row, Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import { cn } from '@/lib/utils';

import { CategoryIcon } from './category-icon';

type Group = { parent: CategoryResponse; children: CategoryResponse[] };

/** Mãe com subcategorias ganha grupo próprio; as sem filhas seguidas dividem um grupo só. */
export function sections(groups: Group[]): Group[][] {
  const result: Group[][] = [];
  for (const group of groups) {
    const last = result.at(-1);
    if (group.children.length === 0 && last && last.at(-1)!.children.length === 0) last.push(group);
    else result.push([group]);
  }
  return result;
}

/**
 * Campo de categoria: mostra o ícone e o nome da escolhida e abre, por cima da folha, a lista de
 * categorias com os ícones (mães e, recuadas, as subcategorias), como os seletores do iOS.
 */
export function CategoryPicker({
  value,
  onChange,
  groups,
  kind,
  title = 'Categoria',
  placeholder,
  disabledIds = [],
  disabledHint,
}: {
  value: string;
  onChange: (value: string) => void;
  groups: Group[];
  kind: TransactionKind;
  title?: string;
  /** Com ele, há a opção "sem categoria" (valor vazio) com esse nome. */
  placeholder?: string;
  /** Aparecem apagadas e não podem ser escolhidas. */
  disabledIds?: string[];
  disabledHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const all = groups.flatMap((g) => [g.parent, ...g.children]);
  const selected = all.find((c) => c.id === value);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
  }

  function option(category: CategoryResponse, child: boolean) {
    const disabled = disabledIds.includes(category.id) && category.id !== value;
    return (
      <Row
        key={category.id}
        className={cn(child && 'pl-9')}
        disabled={disabled}
        onClick={() => choose(category.id)}
        leading={<CategoryIcon category={category} kind={kind} size={child ? 'sm' : 'md'} />}
        title={<span className={cn(!child && 'font-semibold')}>{category.name}</span>}
        subtitle={disabled ? disabledHint : undefined}
        trailing={
          category.id === value ? (
            <Check className='text-tint size-5 shrink-0' strokeWidth={2.6} />
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='flex max-w-full min-w-0 items-center gap-2 active:opacity-40'
      >
        {selected ? (
          <>
            <CategoryIcon category={selected} kind={kind} size='sm' />
            <span className='text-body text-label-2 truncate'>{selected.name}</span>
          </>
        ) : (
          <span className='text-body text-label-2 truncate'>{placeholder ?? 'Escolher'}</span>
        )}
        <svg
          aria-hidden
          viewBox='0 0 10 16'
          className='text-label-3 h-3.5 w-2.5 shrink-0'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <path d='M2 6l3-3 3 3M2 10l3 3 3-3' />
        </svg>
      </button>

      <Sheet nested open={open} onOpenChange={setOpen} title={title} tall>
        {placeholder !== undefined && (
          <Section>
            <Row
              onClick={() => choose('')}
              leading={
                <IconChip color='var(--gray)' round>
                  <Ban strokeWidth={2.25} />
                </IconChip>
              }
              title={placeholder}
              trailing={
                !value ? (
                  <Check className='text-tint size-5 shrink-0' strokeWidth={2.6} />
                ) : undefined
              }
            />
          </Section>
        )}
        {groups.length === 0 ? (
          <p className='text-footnote text-label-2 px-4 text-center'>
            Nenhuma categoria para escolher.
          </p>
        ) : (
          sections(groups).map((section) => (
            <Section key={section[0].parent.id}>
              {section.flatMap(({ parent, children }) => [
                option(parent, false),
                ...children.map((child) => option(child, true)),
              ])}
            </Section>
          ))
        )}
      </Sheet>
    </>
  );
}
