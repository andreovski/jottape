import type { TaskResponse } from '@jottape/schemas';
import { Repeat } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { CheckCircle } from '@/components/ios/controls';
import { useUpdateTransaction } from '@/features/finance';
import { useCompleteTask, useUpdateTask } from '@/features/tasks';
import { cn } from '@/lib/utils';

import { dueInfo, priorityMark, visibleSubtasks } from './task-logic';

/** Concluir (ou reabrir) uma tarefa, com os avisos do Lembretes. */
export function useToggleTask() {
  const complete = useCompleteTask();
  const update = useUpdateTask();
  const updateTransaction = useUpdateTransaction();

  return async (task: TaskResponse) => {
    if (task.completedAt) {
      await update.mutateAsync({ id: task.id, completed: false });
      return;
    }
    const result = await complete.mutateAsync(task.id);
    if (result.next) {
      const info = dueInfo(result.next, new Date());
      toast(info ? `Próxima: ${info.label}` : 'Próxima ocorrência criada', {
        description: result.next.title,
      });
    }
    const transactionId = result.linkedPlannedTransactionId;
    if (transactionId) {
      toast('Lançamento ainda previsto', {
        description: 'Este lembrete está ligado a um lançamento em Finanças.',
        duration: 8000,
        action: {
          label: 'Marcar como paga',
          onClick: () =>
            updateTransaction.mutate(
              { id: transactionId, status: 'DONE' },
              { onSuccess: () => toast.success('Lançamento marcado como pago') }
            ),
        },
      });
    }
  };
}

type Phase = 'idle' | 'toggled' | 'leaving';

interface TaskRowProps {
  task: TaskResponse;
  color: string;
  now: Date;
  onOpen: (task: TaskResponse) => void;
  onToggle: (task: TaskResponse) => Promise<void>;
  /** Visão de concluídas: subtarefas concluídas também aparecem. */
  showCompletedSubtasks?: boolean;
  nested?: boolean;
  /** Linha extra (nome da lista nos resultados da busca). */
  extra?: ReactNode;
  className?: string;
}

/**
 * Linha do Lembretes: círculo, prioridade, título, notas e prazo; subtarefas recuadas embaixo. Ao
 * concluir, o círculo enche na hora e a linha some ~0,7 s depois (dá para desmarcar antes).
 */
export function TaskRow({
  task,
  color,
  now,
  onOpen,
  onToggle,
  showCompletedSubtasks,
  nested,
  extra,
  className,
}: TaskRowProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((id) => window.clearTimeout(id));
  }, []);

  const done = Boolean(task.completedAt);
  const checked = phase === 'idle' ? done : !done;

  function toggle() {
    if (phase === 'toggled') {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
      setPhase('idle');
      return;
    }
    if (phase === 'leaving') return;
    setPhase('toggled');
    timers.current.push(
      window.setTimeout(() => setPhase('leaving'), 700),
      window.setTimeout(() => {
        onToggle(task).catch(() => setPhase('idle'));
      }, 1000)
    );
  }

  const due = dueInfo(task, now);
  const mark = priorityMark(task.priority);
  const subtasks = nested ? [] : visibleSubtasks(task, Boolean(showCompletedSubtasks));
  const notes = task.notes?.split('\n').find((line) => line.trim());
  const hasMeta = Boolean(due || task.rrule || task.tags.length || (nested ? false : extra));

  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
        phase === 'leaving' ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
        className
      )}
    >
      <div className='min-h-0 overflow-hidden'>
        <div
          role='button'
          tabIndex={0}
          onClick={() => onOpen(task)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target === event.currentTarget) onOpen(task);
          }}
          className={cn(
            'active:bg-fill flex w-full cursor-default items-start gap-2.5 text-left transition-colors duration-75 outline-none focus-visible:bg-fill',
            nested ? 'pl-[52px]' : 'pl-3'
          )}
        >
          <div className={cn(nested ? 'pt-[7px] [&_span]:size-[18px] [&_svg]:size-3' : 'pt-[8px]')}>
            <CheckCircle
              checked={checked}
              onChange={toggle}
              color={color}
              label={checked ? `Reabrir ${task.title}` : `Concluir ${task.title}`}
            />
          </div>
          <div
            data-sep
            className={cn(
              'min-w-0 flex-1 pr-4 shadow-[inset_0_-0.5px_0_var(--separator)]',
              nested ? 'py-[8px]' : 'py-[11px]'
            )}
          >
            <div
              className={cn(
                'break-words transition-colors duration-200',
                nested ? 'text-subhead' : 'text-body',
                checked && 'text-label-2'
              )}
            >
              {mark && (
                <span
                  className='text-tint mr-1 font-semibold tracking-tight'
                  aria-label='Prioridade'
                >
                  {mark}
                </span>
              )}
              {task.title}
            </div>
            {notes && !nested && (
              <div className='text-subhead text-label-2 mt-0.5 truncate'>{notes}</div>
            )}
            {hasMeta && (
              <div
                className={cn(
                  'text-label-2 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5',
                  nested ? 'text-footnote' : 'text-subhead'
                )}
              >
                {due && (
                  <span className={cn('numeric', due.overdue && !checked && 'text-red')}>
                    {due.label}
                  </span>
                )}
                {task.rrule && (
                  <Repeat className='size-[13px] shrink-0' strokeWidth={2.25} aria-label='Repete' />
                )}
                {task.tags.map((tag) => (
                  <span key={tag} className='text-label-2'>
                    #{tag}
                  </span>
                ))}
                {!nested && extra}
              </div>
            )}
          </div>
        </div>

        {subtasks.map((sub) => (
          <TaskRow
            key={sub.id}
            task={sub}
            color={color}
            now={now}
            onOpen={onOpen}
            onToggle={onToggle}
            nested
          />
        ))}
      </div>
    </div>
  );
}

/** Cartão de linhas; o último separador fica escondido sob a borda. */
/** Rótulo de grupo dentro do cartão de tarefas (Hoje, Em breve, Sem data). */
export function TaskGroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className='text-footnote text-label-2 bg-fill/50 px-4 pt-2.5 pb-1 font-semibold uppercase'>
      {children}
    </div>
  );
}

export function TaskCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('bg-surface overflow-hidden rounded-[var(--radius)]', className)}>
      <div className='-mb-px'>{children}</div>
    </div>
  );
}
