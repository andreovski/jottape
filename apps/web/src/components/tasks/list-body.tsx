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
import { useRef, useState } from 'react';

import { CheckCircle, Skeleton } from '@/components/ios/controls';
import { applyOrder, type ListTarget, moveId, quickAddBody } from '@/components/tasks/task-logic';
import { TaskCard, TaskRow } from '@/components/tasks/task-row';
import { useCreateTask, useReorderTasks, useTasks } from '@/features/tasks';
import { appTimeZone, todayKey } from '@/lib/format';
import { cn } from '@/lib/utils';

// Pedaços da lista de lembretes da tela Tarefas: linhas arrastáveis, concluídas, "Novo lembrete".

export type RowProps = {
  color: string;
  now: Date;
  onOpen: (task: TaskResponse) => void;
  onToggle: (task: TaskResponse) => Promise<void>;
};

export function SortableRows({
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

export function CompletedSection({
  list,
  rowProps,
}: {
  list: TaskListResponse;
  rowProps: RowProps;
}) {
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
export function QuickAdd({ target, color }: { target: ListTarget; color: string }) {
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

export function RowsSkeleton() {
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
