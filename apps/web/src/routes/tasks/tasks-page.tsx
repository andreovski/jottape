import type { TaskListResponse, TaskResponse } from '@jottape/schemas';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { CircleCheck, Ellipsis, ListX, Plus, Search, SunMedium } from 'lucide-react';
import { type CSSProperties, Fragment, useDeferredValue, useEffect, useState } from 'react';

import { EmptyState } from '@/components/ios/controls';
import { Row } from '@/components/ios/list';
import { BarButton, Page } from '@/components/ios/page';
import { ActionSheet } from '@/components/ios/sheet';
import { SettingsButton } from '@/components/settings-button';
import {
  FilterBar,
  FilterPanel,
  FilterSheet,
  type TaskFilter,
  useSmartCounts,
} from '@/components/tasks/filters';
import { useNow, useRootTint, useSheetState } from '@/components/tasks/hooks';
import {
  CompletedSection,
  QuickAdd,
  type RowProps,
  RowsSkeleton,
  SortableRows,
} from '@/components/tasks/list-body';
import { ListSheet } from '@/components/tasks/list-sheet';
import { SearchField } from '@/components/tasks/search-field';
import {
  ALL_COLOR_CLASS,
  canQuickAdd,
  groupBySchedule,
  listColor,
  queryForTarget,
  resolveListParam,
} from '@/components/tasks/task-logic';
import { TaskCard, TaskGroupLabel, TaskRow, useToggleTask } from '@/components/tasks/task-row';
import { TaskSheet, type TaskSheetDefaults } from '@/components/tasks/task-sheet';
import { useClearCompleted, useDeleteTaskList, useTaskLists, useTasks } from '@/features/tasks';
import { todayKey } from '@/lib/format';
import { useIsWide } from '@/lib/use-desktop';

interface Confirm {
  title: string;
  message?: string;
  label: string;
  onConfirm: () => void;
}

/**
 * Tarefas numa tela só: a faixa de filtros no topo (listas inteligentes, listas e etiquetas, e o
 * botão que abre todos eles numa folha) e, embaixo, os lembretes do filtro numa lista única.
 */
export function TasksPage() {
  const { filtro = 'todas', tag, novo } = useSearch({ from: '/app/tarefas' });
  const navigate = useNavigate();
  const wide = useIsWide();
  const lists = useTaskLists();
  const counts = useSmartCounts(lists.data);
  const target = resolveListParam(filtro, tag);
  const list = target.kind === 'list' ? lists.data?.find((l) => l.id === target.id) : undefined;
  const byId = new Map((lists.data ?? []).map((item) => [item.id, item]));

  const color =
    target.kind === 'smart' ? target.meta.color : list ? listColor(list) : 'var(--orange)';
  useRootTint(color);

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const tasks = useTasks(queryForTarget(target));
  const toggle = useToggleTask();
  const clearCompleted = useClearCompleted();
  const deleteList = useDeleteTaskList();
  const now = useNow();
  const today = todayKey();

  const [filterOpen, setFilterOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // `?novo=1` (vindo da tela Hoje) já abre a folha de novo lembrete; depois some da URL.
  const taskSheet = useSheetState<TaskResponse | null>(novo ? { value: null } : undefined);
  useEffect(() => {
    if (!novo) return;
    navigate({ to: '/tarefas', search: { filtro, tag }, replace: true });
  }, [novo, navigate, filtro, tag]);
  const listSheet = useSheetState<TaskListResponse | null>();

  function setFilter(next: TaskFilter) {
    setShowCompleted(false);
    navigate({
      to: '/tarefas',
      search: { filtro: next.filtro === 'todas' ? undefined : next.filtro, tag: next.tag },
      replace: true,
    });
  }

  const isCompletedView = target.kind === 'smart' && target.meta.slug === 'concluidas';
  const isAllView = target.kind === 'smart' && target.meta.slug === 'todas';
  const notFound = target.kind === 'list' && lists.isSuccess && !list;

  const sheetDefaults: TaskSheetDefaults =
    target.kind === 'list'
      ? { listId: target.id, tags: target.tag ? [target.tag] : undefined }
      : {
          listId: lists.data?.find((item) => item.isInbox)?.id,
          date: ['hoje', 'programadas'].includes(target.meta.slug) ? today : undefined,
          tags: target.tag ? [target.tag] : undefined,
        };

  function ask(next: Confirm) {
    setConfirm(next);
    setConfirmOpen(true);
  }

  const menuActions: { label: string; onSelect: () => void; destructive?: boolean }[] = [];
  if (list) {
    menuActions.push(
      { label: 'Editar lista', onSelect: () => listSheet.show(list) },
      {
        label: showCompleted ? 'Ocultar concluídas' : 'Mostrar concluídas',
        onSelect: () => setShowCompleted((value) => !value),
      },
      {
        label: 'Apagar concluídas',
        onSelect: () =>
          ask({
            title: `Apagar os lembretes concluídos de “${list.name}”?`,
            label: 'Apagar concluídas',
            onConfirm: () => clearCompleted.mutate(list.id),
          }),
      }
    );
    if (!list.isInbox) {
      menuActions.push({
        label: 'Apagar lista',
        destructive: true,
        onSelect: () =>
          ask({
            title: `Apagar “${list.name}”?`,
            message: 'Todos os lembretes desta lista também serão apagados.',
            label: 'Apagar lista',
            onConfirm: () =>
              deleteList.mutate(list.id, { onSuccess: () => setFilter({ filtro: 'todas' }) }),
          }),
      });
    }
  } else if (isCompletedView && tasks.data?.length) {
    menuActions.push({
      label: 'Apagar concluídas',
      destructive: true,
      onSelect: () =>
        ask({
          title: 'Apagar todos os lembretes concluídos?',
          message: 'Isso não pode ser desfeito.',
          label: 'Apagar concluídas',
          onConfirm: () => clearCompleted.mutate(undefined),
        }),
    });
  }

  const rowProps: RowProps = {
    color,
    now,
    onOpen: (task) => taskSheet.show(task),
    onToggle: toggle,
  };

  /** Fora de uma lista, cada lembrete mostra de qual lista é (a bolinha na cor dela). */
  function listLabel(task: TaskResponse) {
    const owner = byId.get(task.listId);
    if (!owner) return null;
    return (
      <span className='inline-flex items-center gap-1'>
        <span className='size-2 rounded-full' style={{ backgroundColor: listColor(owner) }} />
        {owner.name}
      </span>
    );
  }

  let body: React.ReactNode;
  if (deferredSearch) {
    body = <SearchResults search={deferredSearch} rowProps={rowProps} listLabel={listLabel} />;
  } else if (notFound) {
    body = (
      <EmptyState
        icon={<ListX />}
        title='Lista não encontrada'
        message='Ela pode ter sido apagada.'
        action={
          <button
            type='button'
            className='text-tint text-body'
            onClick={() => setFilter({ filtro: 'todas' })}
          >
            Ver todas
          </button>
        }
      />
    );
  } else if (tasks.isPending || (target.kind === 'list' && lists.isPending)) {
    body = <RowsSkeleton />;
  } else {
    const data = tasks.data ?? [];
    const quickAdd = canQuickAdd(target) ? <QuickAdd target={target} color={color} /> : null;
    body = (
      <>
        {data.length > 0 && <CountLine count={data.length} completed={isCompletedView} />}
        {!data.length && (
          <EmptyState
            icon={
              target.kind === 'smart' && target.meta.slug === 'hoje' ? (
                <SunMedium />
              ) : (
                <CircleCheck />
              )
            }
            title={target.kind === 'smart' ? target.meta.emptyTitle : 'Nenhum lembrete'}
            message={
              target.kind === 'smart' && target.meta.slug === 'hoje'
                ? 'Nada para hoje. Aproveite o dia.'
                : undefined
            }
          />
        )}
        {(data.length > 0 || quickAdd) && (
          <TaskCard className='mb-6'>
            {target.kind === 'list' && !target.tag ? (
              <SortableRows listId={target.id} tasks={data} rowProps={rowProps} />
            ) : isAllView && data.length > 0 ? (
              groupBySchedule(data, { today }).map((group) => (
                <Fragment key={group.id}>
                  <TaskGroupLabel>{group.title}</TaskGroupLabel>
                  {group.id === 'hoje' && !group.tasks.length && (
                    <Row
                      leading={<CircleCheck className='text-orange size-[22px]' />}
                      title={<span className='text-label-2'>Nada para hoje</span>}
                    />
                  )}
                  {group.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      {...rowProps}
                      color={listColorOf(byId, task.listId, color)}
                      extra={listLabel(task)}
                    />
                  ))}
                </Fragment>
              ))
            ) : (
              data.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  {...rowProps}
                  color={target.kind === 'list' ? color : listColorOf(byId, task.listId, color)}
                  showCompletedSubtasks={isCompletedView}
                  extra={target.kind === 'smart' ? listLabel(task) : undefined}
                />
              ))
            )}
            {quickAdd}
          </TaskCard>
        )}
        {list && showCompleted && <CompletedSection list={list} rowProps={rowProps} />}
      </>
    );
  }

  return (
    <div className={ALL_COLOR_CLASS} style={{ '--tint': color } as CSSProperties}>
      <Page
        wide
        title='Tarefas'
        actions={
          <>
            <SettingsButton />
            {menuActions.length > 0 && (
              <BarButton label='Mais opções' onClick={() => setMenuOpen(true)}>
                <span className='border-tint flex size-[22px] items-center justify-center rounded-full border-[1.75px]'>
                  <Ellipsis className='size-3.5!' strokeWidth={3} />
                </span>
              </BarButton>
            )}
            <BarButton label='Adicionar' onClick={() => setAddOpen(true)}>
              <Plus strokeWidth={2.25} />
            </BarButton>
          </>
        }
      >
        {wide ? (
          // Tela larga: os filtros ficam à vista numa coluna, e a busca vai com os lembretes.
          <div className='grid grid-cols-[18rem_minmax(0,1fr)] items-start gap-8'>
            <aside
              aria-label='Listas'
              className='sticky top-[calc(env(safe-area-inset-top)+4.5rem)]'
            >
              <FilterPanel
                value={{ filtro, tag }}
                lists={lists.data}
                counts={counts}
                onChange={setFilter}
                onNewList={() => listSheet.show(null)}
              />
            </aside>
            <div className='min-w-0'>
              <div className='mb-4'>
                <SearchField value={search} onChange={setSearch} />
              </div>
              {body}
            </div>
          </div>
        ) : (
          <>
            <div className='mb-3'>
              <SearchField value={search} onChange={setSearch} />
            </div>
            {!deferredSearch && (
              <FilterBar
                value={{ filtro, tag }}
                lists={lists.data}
                counts={counts}
                onChange={setFilter}
                onOpenSheet={() => setFilterOpen(true)}
              />
            )}

            {body}
          </>
        )}
      </Page>

      <FilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        value={{ filtro, tag }}
        lists={lists.data}
        counts={counts}
        onChange={setFilter}
        onNewList={() => {
          setFilterOpen(false);
          listSheet.show(null);
        }}
      />
      <ActionSheet open={menuOpen} onOpenChange={setMenuOpen} actions={menuActions} />
      <ActionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        actions={[
          { label: 'Novo lembrete', onSelect: () => taskSheet.show(null) },
          { label: 'Adicionar lista', onSelect: () => listSheet.show(null) },
        ]}
      />
      <ActionSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={confirm?.title}
        message={confirm?.message}
        actions={
          confirm ? [{ label: confirm.label, destructive: true, onSelect: confirm.onConfirm }] : []
        }
      />
      <TaskSheet
        key={`task-${taskSheet.key}`}
        open={taskSheet.open}
        onOpenChange={taskSheet.setOpen}
        task={taskSheet.value}
        defaults={sheetDefaults}
      />
      <ListSheet
        key={`list-${listSheet.key}`}
        open={listSheet.open}
        onOpenChange={listSheet.setOpen}
        list={listSheet.value}
        onCreated={(created) => setFilter({ filtro: created.id })}
      />
    </div>
  );
}

function listColorOf(byId: Map<string, TaskListResponse>, listId: string, fallback: string) {
  const owner = byId.get(listId);
  return owner ? listColor(owner) : fallback;
}

function CountLine({ count, completed }: { count: number; completed: boolean }) {
  const noun = completed
    ? count === 1
      ? 'concluído'
      : 'concluídos'
    : count === 1
      ? 'lembrete'
      : 'lembretes';
  return (
    <div className='text-footnote text-label-2 mb-1.5 px-4 uppercase'>
      {count} {noun}
    </div>
  );
}

function SearchResults({
  search,
  rowProps,
  listLabel,
}: {
  search: string;
  rowProps: RowProps;
  listLabel: (task: TaskResponse) => React.ReactNode;
}) {
  const results = useTasks({ search: search.slice(0, 80) });
  const lists = useTaskLists();
  const byId = new Map((lists.data ?? []).map((item) => [item.id, item]));

  if (results.isPending) return <RowsSkeleton />;

  if (!results.data?.length) {
    return (
      <EmptyState
        icon={<Search />}
        title='Nenhum resultado'
        message={`Nada encontrado para “${search}”.`}
      />
    );
  }

  return (
    <>
      <div className='text-footnote text-label-2 mb-1.5 px-4 uppercase'>
        {results.data.length} {results.data.length === 1 ? 'resultado' : 'resultados'}
      </div>
      <TaskCard className='mb-7'>
        {results.data.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            {...rowProps}
            color={listColorOf(byId, task.listId, rowProps.color)}
            extra={listLabel(task)}
          />
        ))}
      </TaskCard>
    </>
  );
}
