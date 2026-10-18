import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskListResponse, TaskResponse } from '@jottape/schemas';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ChevronLeft, CircleCheck, Ellipsis, ListX, SunMedium } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';

import { CheckCircle, EmptyState, Skeleton } from '@/components/ios/controls';
import { BarButton, Page } from '@/components/ios/page';
import { ActionSheet } from '@/components/ios/sheet';
import { BottomBar } from '@/components/tasks/bottom-bar';
import { useNow, useRootTint, useSheetState } from '@/components/tasks/hooks';
import { ListSheet } from '@/components/tasks/list-sheet';
import {
  ALL_COLOR_CLASS,
  applyOrder,
  canQuickAdd,
  groupTasks,
  listColor,
  type ListTarget,
  moveId,
  queryForTarget,
  quickAddBody,
  resolveListParam,
} from '@/components/tasks/task-logic';
import { TaskCard, TaskRow, useToggleTask } from '@/components/tasks/task-row';
import { TaskSheet, type TaskSheetDefaults } from '@/components/tasks/task-sheet';
import {
  useClearCompleted,
  useCreateTask,
  useDeleteTaskList,
  useReorderTasks,
  useTaskLists,
  useTasks,
} from '@/features/tasks';
import { appTimeZone, todayKey } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Confirm {
  title: string;
  message?: string;
  label: string;
  onConfirm: () => void;
}

export function TaskListPage() {
  const { listId } = useParams({ from: '/tarefas/$listId' });
  const { tag, novo } = useSearch({ from: '/tarefas/$listId' });
  const navigate = useNavigate();
  const lists = useTaskLists();
  const target = resolveListParam(listId, tag);
  const list = target.kind === 'list' ? lists.data?.find((l) => l.id === target.id) : undefined;

  const title =
    target.kind === 'smart'
      ? target.tag
        ? `#${target.tag}`
        : target.meta.title
      : (list?.name ?? '');
  const color =
    target.kind === 'smart'
      ? target.tag
        ? 'var(--orange)'
        : target.meta.color
      : list
        ? listColor(list)
        : 'var(--orange)';
  useRootTint(color);

  const tasks = useTasks(queryForTarget(target));
  const toggle = useToggleTask();
  const clearCompleted = useClearCompleted();
  const deleteList = useDeleteTaskList();
  const now = useNow();
  const today = todayKey();

  const [showCompleted, setShowCompleted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // `?novo=1` (vindo da tela Hoje) já abre a folha de novo lembrete; depois some da URL.
  const taskSheet = useSheetState<TaskResponse | null>(novo ? { value: null } : undefined);
  useEffect(() => {
    if (!novo) return;
    navigate({
      to: '/tarefas/$listId',
      params: { listId },
      search: { tag, novo: undefined },
      replace: true,
    });
  }, [novo, navigate, listId, tag]);
  const listSheet = useSheetState<TaskListResponse>();

  const isCompletedView = target.kind === 'smart' && target.meta.slug === 'concluidas';
  const notFound = target.kind === 'list' && lists.isSuccess && !list;

  const sheetDefaults: TaskSheetDefaults =
    target.kind === 'list'
      ? { listId: target.id }
      : {
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
              deleteList.mutate(list.id, { onSuccess: () => navigate({ to: '/tarefas' }) }),
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

  const openTask = (task: TaskResponse) => taskSheet.show(task);
  const rowProps = { color, now, onOpen: openTask, onToggle: toggle };

  let body: React.ReactNode;
  if (notFound) {
    body = (
      <EmptyState
        icon={<ListX />}
        title='Lista não encontrada'
        message='Ela pode ter sido apagada.'
        action={
          <Link to='/tarefas' className='text-tint text-body'>
            Voltar para Tarefas
          </Link>
        }
      />
    );
  } else if (tasks.isPending || (target.kind === 'list' && lists.isPending)) {
    body = <RowsSkeleton />;
  } else {
    const data = tasks.data ?? [];
    const quickAdd = canQuickAdd(target) ? <QuickAdd target={target} color={color} /> : null;
    const groupMode =
      target.kind === 'smart' && !target.tag
        ? target.meta.slug === 'programadas'
          ? 'day'
          : target.meta.slug === 'todas'
            ? 'list'
            : null
        : null;

    const empty = !data.length && (
      <EmptyState
        icon={
          target.kind === 'smart' && target.meta.slug === 'hoje' ? <SunMedium /> : <CircleCheck />
        }
        title={target.kind === 'smart' ? target.meta.emptyTitle : 'Nenhum lembrete'}
        message={
          target.kind === 'smart' && target.meta.slug === 'hoje'
            ? 'Nada para hoje. Aproveite o dia.'
            : undefined
        }
      />
    );

    if (groupMode && data.length) {
      const groups = groupTasks(data, groupMode, {
        lists: lists.data,
        today,
        timeZone: appTimeZone(),
      });
      body = (
        <>
          {groups.map((group) => (
            <section key={group.id} className='mb-6'>
              <h2
                className={cn(
                  'mb-1.5 px-1',
                  groupMode === 'list' ? 'text-title-3' : 'text-headline'
                )}
                style={group.color ? { color: group.color } : undefined}
              >
                {group.title}
              </h2>
              <TaskCard>
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} {...rowProps} color={group.color ?? color} />
                ))}
              </TaskCard>
            </section>
          ))}
          {quickAdd && <TaskCard>{quickAdd}</TaskCard>}
        </>
      );
    } else {
      body = (
        <>
          {empty}
          {(data.length > 0 || quickAdd) && (
            <TaskCard className='mb-6'>
              {target.kind === 'list' ? (
                <SortableRows listId={target.id} tasks={data} rowProps={rowProps} />
              ) : (
                data.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    {...rowProps}
                    showCompletedSubtasks={isCompletedView}
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
  }

  return (
    <div className={ALL_COLOR_CLASS} style={{ '--tint': color } as CSSProperties}>
      <Page
        title={title || ' '}
        leading={
          <Link
            to='/tarefas'
            className='text-tint text-body -ml-2 flex items-center active:opacity-40'
          >
            <ChevronLeft className='size-7' strokeWidth={2.25} />
            Tarefas
          </Link>
        }
        actions={
          menuActions.length > 0 && (
            <BarButton label='Mais opções' onClick={() => setMenuOpen(true)}>
              <span className='border-tint flex size-[22px] items-center justify-center rounded-full border-[1.75px]'>
                <Ellipsis className='size-3.5!' strokeWidth={3} />
              </span>
            </BarButton>
          )
        }
        className='[&_h1]:text-tint'
      >
        {body}
        {!notFound && <BottomBar onNew={() => taskSheet.show(null)} />}
      </Page>

      <ActionSheet open={menuOpen} onOpenChange={setMenuOpen} actions={menuActions} />
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
      />
    </div>
  );
}

type RowProps = {
  color: string;
  now: Date;
  onOpen: (task: TaskResponse) => void;
  onToggle: (task: TaskResponse) => Promise<void>;
};

function SortableRows({
  listId,
  tasks,
  rowProps,
}: {
  listId: string;
  tasks: TaskResponse[];
  rowProps: RowProps;
}) {
  const reorder = useReorderTasks();
  const [order, setOrder] = useState<string[] | null>(null);
  const ordered = applyOrder(tasks, order);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
  );

  // O clique que fecha um arrasto não deve abrir os detalhes do lembrete.
  const dragging = useRef(false);
  const guardedProps: RowProps = {
    ...rowProps,
    onOpen: (task) => {
      if (!dragging.current) rowProps.onOpen(task);
    },
  };

  function release() {
    window.setTimeout(() => {
      dragging.current = false;
    }, 80);
  }

  function onDragEnd(event: DragEndEvent) {
    release();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = moveId(
      ordered.map((task) => task.id),
      String(active.id),
      String(over.id)
    );
    setOrder(ids);
    reorder.mutate({ listId, orderedIds: ids }, { onSettled: () => setOrder(null) });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      onDragStart={() => {
        dragging.current = true;
      }}
      onDragCancel={release}
    >
      <SortableContext
        items={ordered.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        {ordered.map((task) => (
          <SortableTask key={task.id} task={task} rowProps={guardedProps} />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableTask({ task, rowProps }: { task: TaskResponse; rowProps: RowProps }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'relative bg-surface',
        isDragging && 'z-10 rounded-[10px] shadow-[0_10px_30px_rgb(0_0_0/0.18)] dark:bg-surface-2'
      )}
      {...attributes}
      {...listeners}
      tabIndex={-1}
    >
      <TaskRow task={task} {...rowProps} />
    </div>
  );
}

function CompletedSection({ list, rowProps }: { list: TaskListResponse; rowProps: RowProps }) {
  const completed = useTasks({ listId: list.id, view: 'completed' });
  if (completed.isPending) return <RowsSkeleton />;
  if (!completed.data?.length) {
    return <p className='text-subhead text-label-2 px-4 pb-6 text-center'>Nenhum concluído.</p>;
  }
  return (
    <>
      <div className='text-footnote text-label-2 mb-1.5 px-4 uppercase'>
        {completed.data.length} {completed.data.length === 1 ? 'concluído' : 'concluídos'}
      </div>
      <TaskCard className='mb-6'>
        {completed.data.map((task) => (
          <TaskRow key={task.id} task={task} {...rowProps} showCompletedSubtasks />
        ))}
      </TaskCard>
    </>
  );
}

/** "Novo lembrete" no fim da lista: Enter cria e o campo continua aberto para o próximo. */
function QuickAdd({ target, color }: { target: ListTarget; color: string }) {
  const create = useCreateTask();
  const [title, setTitle] = useState('');
  const input = useRef<HTMLInputElement>(null);

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    create.mutate(quickAddBody(trimmed, target, { today: todayKey(), timeZone: appTimeZone() }));
    setTitle('');
    input.current?.focus();
  }

  return (
    <div className='flex items-center gap-2.5 pl-3'>
      <div className='pointer-events-none opacity-60'>
        <CheckCircle
          checked={false}
          onChange={() => undefined}
          color={color}
          label='Novo lembrete'
        />
      </div>
      <input
        ref={input}
        aria-label='Novo lembrete'
        placeholder='Novo lembrete'
        value={title}
        enterKeyHint='done'
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
          if (event.key === 'Escape') {
            setTitle('');
            input.current?.blur();
          }
        }}
        onBlur={submit}
        className='text-body placeholder:text-label-3 min-h-11 min-w-0 flex-1 bg-transparent py-[11px] pr-4 outline-none'
      />
    </div>
  );
}

function RowsSkeleton() {
  return (
    <TaskCard className='mb-6'>
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className='flex items-center gap-3 py-3 pr-4 pl-4'>
          <Skeleton className='size-[22px] rounded-full' />
          <div className='flex-1 space-y-1.5'>
            <Skeleton className='h-4 w-3/5' />
            {index % 2 === 0 && <Skeleton className='h-3 w-1/4' />}
          </div>
        </div>
      ))}
    </TaskCard>
  );
}
