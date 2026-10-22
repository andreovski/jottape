import type { CategoryKind, CategoryResponse } from '@jottape/schemas';
import { useNavigate } from '@tanstack/react-router';
import { ChevronLeft, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { CATEGORY_ICONS, CategoryIcon } from '@/components/finance/category-icon';
import { Button, EmptyState, Segmented, Skeleton } from '@/components/ios/controls';
import { ColorPicker, FieldError, SWATCHES } from '@/components/ios/fields';
import { Row, Section } from '@/components/ios/list';
import { BarButton, Page } from '@/components/ios/page';
import { ActionSheet, Sheet } from '@/components/ios/sheet';
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from '@/features/finance';
import { useFormErrors } from '@/lib/use-form-errors';
import { cn } from '@/lib/utils';

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

/** Ícones por página no seletor: 3 linhas de 6. */
const ICONS_PER_PAGE = 18;

export function iconPages<T>(icons: T[], perPage = ICONS_PER_PAGE): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < icons.length; i += perPage) pages.push(icons.slice(i, i + perPage));
  return pages;
}

/** Grade de ícones em páginas que deslizam para o lado, com bolinhas de página embaixo. */
function IconPicker({
  value,
  onChange,
  startAtValue,
}: {
  value: string | null;
  onChange: (icon: string) => void;
  /** Ao editar, abre na página do ícone escolhido; numa categoria nova, na primeira. */
  startAtValue: boolean;
}) {
  const pages = iconPages(CATEGORY_ICONS);
  const scroller = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(() =>
    startAtValue
      ? Math.max(
          0,
          pages.findIndex((icons) => icons.some((i) => i.name === value))
        )
      : 0
  );

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = page * el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goTo = (index: number) => {
    const el = scroller.current;
    el?.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          setPage(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className='no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain'
      >
        {pages.map((icons, index) => (
          <div
            key={index}
            role='group'
            aria-label={`Página ${index + 1} de ${pages.length}`}
            className='grid w-full shrink-0 snap-start grid-cols-6 content-start gap-3 p-4 pb-3'
          >
            {icons.map(({ name: iconName, label, icon: Icon }) => {
              const selected = value === iconName;
              return (
                <button
                  key={iconName}
                  type='button'
                  aria-label={label}
                  title={label}
                  aria-pressed={selected}
                  onClick={() => onChange(iconName)}
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
        ))}
      </div>
      {pages.length > 1 && (
        <div className='flex justify-center gap-2 pb-3'>
          {pages.map((_, index) => (
            <button
              key={index}
              type='button'
              aria-label={`Ir para a página ${index + 1}`}
              aria-current={page === index}
              onClick={() => goTo(index)}
              className={cn(
                'size-[7px] rounded-full transition-colors',
                page === index ? 'bg-label-2' : 'bg-label-3'
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
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
  // A mãe vem de onde a categoria foi criada (o "+ Subcategoria" da mãe); não se escolhe no formulário.
  const parentId = existing?.parentId ?? editing?.parentId ?? null;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const pending = create.isPending || update.isPending;
  const { errors, validate } = useFormErrors({
    name: !name.trim() && 'Dê um nome para a categoria.',
  });

  const hasChildren = existing ? categories.some((c) => c.parentId === existing.id) : false;
  const preview = {
    id: existing?.id ?? 'novo',
    name,
    kind,
    parentId,
    icon,
    color,
  } satisfies CategoryResponse;

  async function save() {
    if (pending || !validate()) return;
    const body = { name: name.trim(), color, icon, parentId };
    if (existing) await update.mutateAsync({ id: existing.id, ...body });
    else await create.mutateAsync({ ...body, kind });
    onClose();
  }

  return (
    <>
      <Sheet
        open={editing !== null}
        onOpenChange={(open) => !open && onClose()}
        title={
          existing
            ? parentId
              ? 'Editar Subcategoria'
              : 'Editar Categoria'
            : parentId
              ? 'Nova Subcategoria'
              : 'Nova Categoria'
        }
        confirmLabel={existing ? 'OK' : 'Adicionar'}
        confirmDisabled={pending}
        onConfirm={save}
        tall
      >
        <div className='flex flex-col items-center pt-2 pb-6'>
          <div className='[&>span]:size-[84px]! [&_svg]:size-10!'>
            <CategoryIcon category={preview} kind={kind} size='lg' />
          </div>
          <div data-field-error={errors.name ? '' : undefined} className='mt-5 w-full'>
            <input
              aria-label='Nome da categoria'
              aria-invalid={Boolean(errors.name)}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder='Nome da categoria'
              maxLength={60}
              className={cn(
                'bg-surface text-title-3 placeholder:text-label-3 h-[52px] w-full rounded-[12px] text-center font-bold outline-none',
                errors.name && 'placeholder:text-red/70'
              )}
            />
            <FieldError message={errors.name} className='mt-2 justify-center' />
          </div>
        </div>

        <Section header='Cor'>
          <ColorPicker value={color} onChange={setColor} />
        </Section>

        <Section header='Ícone'>
          <IconPicker value={icon} onChange={setIcon} startAtValue={Boolean(existing)} />
        </Section>

        {existing && (
          <Button variant='destructive' className='w-full' onClick={() => setConfirmDelete(true)}>
            {parentId ? 'Apagar Subcategoria' : 'Apagar Categoria'}
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
