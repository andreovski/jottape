import type { CategoryKind, CategoryResponse } from '@jottape/schemas';
import { useNavigate } from '@tanstack/react-router';
import { ChevronLeft, Plus } from 'lucide-react';
import { useState } from 'react';

import { CategoryIcon, categoryIconOf } from '@/components/finance/category-icon';
import { Button, EmptyState, Segmented, Skeleton } from '@/components/ios/controls';
import { ColorPicker, FieldRow, SelectInput, SWATCHES } from '@/components/ios/fields';
import { Row, Section } from '@/components/ios/list';
import { BarButton, Page } from '@/components/ios/page';
import { ActionSheet, Sheet } from '@/components/ios/sheet';
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from '@/features/finance';
import { cn } from '@/lib/utils';

/** Ícones oferecidos (os nomes que o `CategoryIcon` conhece). */
const ICON_NAMES = [
  'shopping-cart',
  'utensils',
  'home',
  'car',
  'heart-pulse',
  'graduation-cap',
  'party-popper',
  'repeat',
  'briefcase',
  'plus-circle',
  'circle-ellipsis',
  'tag',
];

type Editing = { category?: CategoryResponse; parentId?: string | null } | null;

/** Mães em ordem alfabética, cada uma seguida das subcategorias. */
export function groupCategories(categories: CategoryResponse[], kind: CategoryKind) {
  const ofKind = categories.filter((c) => c.kind === kind);
  const byName = (a: CategoryResponse, b: CategoryResponse) =>
    a.name.localeCompare(b.name, 'pt-BR');
  return ofKind
    .filter((c) => !c.parentId)
    .sort(byName)
    .map((parent) => ({
      parent,
      children: ofKind.filter((c) => c.parentId === parent.id).sort(byName),
    }));
}

function CategorySheet({
  editing,
  kind,
  categories,
  onClose,
}: {
  editing: Editing;
  kind: CategoryKind;
  categories: CategoryResponse[];
  onClose: () => void;
}) {
  const existing = editing?.category;
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState<string | null>(
    existing?.color ?? (existing ? null : SWATCHES[6])
  );
  const [icon, setIcon] = useState<string | null>(existing?.icon ?? (existing ? null : 'tag'));
  const [parentId, setParentId] = useState(existing?.parentId ?? editing?.parentId ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();

  const hasChildren = existing ? categories.some((c) => c.parentId === existing.id) : false;
  const parents = categories.filter((c) => c.kind === kind && !c.parentId && c.id !== existing?.id);
  const isSub = Boolean(parentId);
  const preview = {
    id: existing?.id ?? 'novo',
    name,
    kind,
    parentId: parentId || null,
    icon,
    color,
  } satisfies CategoryResponse;

  async function save() {
    const body = { name: name.trim(), color, icon, parentId: parentId || null };
    if (existing) await update.mutateAsync({ id: existing.id, ...body });
    else await create.mutateAsync({ ...body, kind });
    onClose();
  }

  return (
    <>
      <Sheet
        open={editing !== null}
        onOpenChange={(open) => !open && onClose()}
        title={existing ? 'Editar Categoria' : 'Nova Categoria'}
        confirmLabel={existing ? 'OK' : 'Adicionar'}
        confirmDisabled={!name.trim() || create.isPending || update.isPending}
        onConfirm={save}
        tall
      >
        <div className='flex flex-col items-center pt-2 pb-6'>
          <div className='[&>span]:size-[84px]! [&_svg]:size-10!'>
            <CategoryIcon category={preview} kind={kind} size='lg' />
          </div>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder='Nome da categoria'
            maxLength={60}
            autoFocus={!existing}
            className='bg-surface text-title-3 placeholder:text-label-3 mt-5 h-[52px] w-full rounded-[12px] text-center font-bold outline-none'
          />
        </div>

        <Section header='Pertence a'>
          <FieldRow label='Categoria-mãe'>
            <SelectInput
              value={parentId}
              onChange={setParentId}
              placeholder='Nenhuma'
              options={hasChildren ? [] : parents.map((p) => ({ value: p.id, label: p.name }))}
            />
          </FieldRow>
        </Section>
        {hasChildren && (
          <p className='text-footnote text-label-2 -mt-5 mb-6 px-4'>
            Esta categoria tem subcategorias, então não pode virar subcategoria.
          </p>
        )}

        <Section
          header='Cor'
          footer={isSub ? 'Sem cor própria, a subcategoria usa a da categoria-mãe.' : undefined}
        >
          <ColorPicker value={color} onChange={setColor} />
        </Section>

        <Section header='Ícone'>
          <div className='grid grid-cols-6 gap-3 p-4'>
            {ICON_NAMES.map((iconName) => {
              const Icon = categoryIconOf(iconName);
              const selected = icon === iconName;
              return (
                <button
                  key={iconName}
                  type='button'
                  aria-label={iconName}
                  aria-pressed={selected}
                  onClick={() => setIcon(iconName)}
                  className={cn(
                    'bg-fill text-label-2 mx-auto flex size-10 items-center justify-center rounded-full transition-transform active:scale-90',
                    selected && 'ring-label-3 text-foreground ring-[3px]'
                  )}
                >
                  <Icon className='size-5' strokeWidth={2.25} />
                </button>
              );
            })}
          </div>
        </Section>

        {existing && (
          <Button variant='destructive' className='w-full' onClick={() => setConfirmDelete(true)}>
            Apagar Categoria
          </Button>
        )}
      </Sheet>
      <ActionSheet
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Apagar “${existing?.name}”?`}
        message={
          hasChildren
            ? 'As subcategorias também serão apagadas. Os lançamentos ficam sem categoria.'
            : 'Os lançamentos desta categoria ficam sem categoria.'
        }
        actions={[
          {
            label: 'Apagar Categoria',
            destructive: true,
            onSelect: async () => {
              await remove.mutateAsync(existing!.id);
              onClose();
            },
          },
        ]}
      />
    </>
  );
}

export function CategoriesPage() {
  const navigate = useNavigate();
  const categories = useCategories();
  const [kind, setKind] = useState<CategoryKind>('EXPENSE');
  const [editing, setEditing] = useState<Editing>(null);
  const groups = groupCategories(categories.data ?? [], kind);

  return (
    <Page
      title='Categorias'
      leading={
        <button
          type='button'
          onClick={() => navigate({ to: '/ajustes' })}
          className='text-tint text-body -ml-2 flex items-center active:opacity-40'
        >
          <ChevronLeft className='size-7' strokeWidth={2.2} />
          Ajustes
        </button>
      }
      actions={
        <BarButton label='Nova categoria' onClick={() => setEditing({})}>
          <Plus strokeWidth={2.4} />
        </BarButton>
      }
      accessory={
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'EXPENSE', label: 'Despesas' },
            { value: 'INCOME', label: 'Receitas' },
          ]}
        />
      }
    >
      {categories.isPending ? (
        <Section>
          <div className='space-y-3 p-4'>
            <Skeleton className='h-8' />
            <Skeleton className='h-8' />
            <Skeleton className='h-8' />
          </div>
        </Section>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Plus />}
          title='Nenhuma categoria'
          message='Toque em + para criar a primeira.'
        />
      ) : (
        groups.map(({ parent, children }) => (
          <Section key={parent.id}>
            <Row
              chevron
              onClick={() => setEditing({ category: parent })}
              leading={<CategoryIcon category={parent} kind={kind} />}
              title={<span className='font-semibold'>{parent.name}</span>}
              detail={children.length > 0 ? children.length : undefined}
            />
            {children.map((child) => (
              <Row
                key={child.id}
                chevron
                className='pl-8'
                onClick={() => setEditing({ category: child })}
                leading={<CategoryIcon category={child} kind={kind} size='sm' />}
                title={child.name}
              />
            ))}
            <Row
              action
              className='pl-8'
              onClick={() => setEditing({ parentId: parent.id })}
              leading={
                <span className='text-tint flex size-[22px] items-center justify-center'>
                  <Plus className='size-[18px]' strokeWidth={2.4} />
                </span>
              }
              title={<span className='text-subhead'>Subcategoria</span>}
            />
          </Section>
        ))
      )}

      {editing !== null && (
        <CategorySheet
          key={editing.category?.id ?? `novo-${editing.parentId ?? ''}`}
          editing={editing}
          kind={kind}
          categories={categories.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </Page>
  );
}
