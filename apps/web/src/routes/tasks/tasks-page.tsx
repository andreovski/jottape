import type { TaskListResponse, TaskResponse } from '@jottape/schemas';
import { Link, useNavigate } from '@tanstack/react-router';
import { Cloud, Search } from 'lucide-react';
import { type CSSProperties, useDeferredValue, useState } from 'react';

import { EmptyState, Skeleton } from '@/components/ios/controls';
import { IconChip, Row, Section, SectionTitle } from '@/components/ios/list';
import { Page } from '@/components/ios/page';
import { BottomBar, SearchField } from '@/components/tasks/bottom-bar';
import { useNow, useRootTint, useSheetState } from '@/components/tasks/hooks';
import { ListIcon, SmartViewIcon } from '@/components/tasks/icons';
import { ListSheet } from '@/components/tasks/list-sheet';
import {
  ALL_COLOR_CLASS,
  listColor,
  SMART_VIEWS,
  type SmartViewMeta,
  sortLists,
} from '@/components/tasks/task-logic';
import { TaskCard, TaskRow, useToggleTask } from '@/components/tasks/task-row';
import { TaskSheet } from '@/components/tasks/task-sheet';
import { useTags, useTaskLists, useTasks } from '@/features/tasks';
import { todayKey } from '@/lib/format';

const TASKS_TINT = 'var(--orange)';

export function TasksPage() {
  useRootTint(TASKS_TINT);
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const taskSheet = useSheetState<TaskResponse | null>();
  const listSheet = useSheetState<null>();
  const lists = useTaskLists();
  const inbox = lists.data?.find((list) => list.isInbox);

  return (
    <div className={ALL_COLOR_CLASS} style={{ '--tint': TASKS_TINT } as CSSProperties}>
      <Page title='Tarefas'>
        <div className='mb-5'>
          <SearchField value={search} onChange={setSearch} />
        </div>

        {deferredSearch ? (
          <SearchResults
            search={deferredSearch}
            lists={lists.data ?? []}
            onOpen={(task) => taskSheet.show(task)}
          />
        ) : (
          <>
            <SmartTiles lists={lists.data} />
            <MyLists lists={lists.data} loading={lists.isPending} />
            <TagCloud />
          </>
        )}

        <BottomBar
          onNew={() => taskSheet.show(null)}
          trailing={
            <button
              type='button'
              onClick={() => listSheet.show(null)}
              className='text-tint text-body active:opacity-50'
            >
              Adicionar Lista
            </button>
          }
        />
      </Page>

      <TaskSheet
        key={`task-${taskSheet.key}`}
        open={taskSheet.open}
        onOpenChange={taskSheet.setOpen}
        task={taskSheet.value}
        defaults={{ listId: inbox?.id }}
      />
      <ListSheet
        key={`list-${listSheet.key}`}
        open={listSheet.open}
        onOpenChange={listSheet.setOpen}
        list={null}
        onCreated={(list) => navigate({ to: '/tarefas/$listId', params: { listId: list.id } })}
      />
    </div>
  );
}

function SmartTiles({ lists }: { lists: TaskListResponse[] | undefined }) {
  const today = useTasks({ view: 'today' });
  const next7 = useTasks({ view: 'next7' });
  const overdue = useTasks({ view: 'overdue' });
  const nodate = useTasks({ view: 'nodate' });
  const day = Number(todayKey().slice(8, 10));

  const counts: Record<string, number | undefined> = {
    hoje: today.data?.length,
    programadas: next7.data?.length,
    atrasadas: overdue.data?.length,
    'sem-prazo': nodate.data?.length,
    todas: lists?.reduce((sum, list) => sum + list.openCount, 0),
  };

  return (
    <div className='mb-7 grid grid-cols-2 gap-3 lg:grid-cols-3'>
      {SMART_VIEWS.map((meta) => (
        <SmartTile key={meta.slug} meta={meta} count={counts[meta.slug]} day={day} />
      ))}
    </div>
  );
}

function SmartTile({
  meta,
  count,
  day,
}: {
  meta: SmartViewMeta;
  count: number | undefined;
  day: number;
}) {
  const hasCount = meta.slug !== 'concluidas';
  return (
    <Link
      to='/tarefas/$listId'
      params={{ listId: meta.slug }}
      className='bg-surface flex h-[84px] flex-col justify-between rounded-[12px] px-3 pt-2.5 pb-2 transition-transform duration-100 active:scale-[0.97] active:opacity-80'
    >
      <div className='flex items-start justify-between'>
        <span
          className='flex size-[34px] items-center justify-center rounded-full text-white [&_svg]:size-[19px]'
          style={{ backgroundColor: meta.color }}
        >
          <SmartViewIcon icon={meta.icon} day={day} />
        </span>
        {hasCount &&
          (count === undefined ? (
            <Skeleton className='mt-1 h-6 w-7 rounded-md' />
          ) : (
            <span className='font-rounded numeric text-[28px] leading-[32px] font-bold'>
              {count}
            </span>
          ))}
      </div>
      <span className='text-label-2 text-[16px] leading-5 font-semibold tracking-tight'>
        {meta.title}
      </span>
    </Link>
  );
}

function MyLists({ lists, loading }: { lists: TaskListResponse[] | undefined; loading: boolean }) {
  const navigate = useNavigate();
  return (
    <>
      <SectionTitle>Minhas listas</SectionTitle>
      <Section>
        {loading
          ? Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className='flex h-[52px] items-center gap-3 px-4'>
                <Skeleton className='size-[29px] rounded-full' />
                <Skeleton className='h-4 flex-1' />
              </div>
            ))
          : sortLists(lists ?? []).map((list) => (
              <Row
                key={list.id}
                onClick={() => navigate({ to: '/tarefas/$listId', params: { listId: list.id } })}
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
                chevron
              />
            ))}
      </Section>
    </>
  );
}

function TagCloud() {
  const tags = useTags();
  const items = tags.data ?? [];
  if (!items.length) return null;
  return (
    <>
      <SectionTitle>Etiquetas</SectionTitle>
      <div className='bg-surface mb-7 flex flex-wrap gap-2 rounded-[var(--radius)] p-3'>
        {items.map((tag) => (
          <Link
            key={tag.id}
            to='/tarefas/$listId'
            params={{ listId: 'todas' }}
            search={{ tag: tag.name }}
            className='bg-fill text-subhead inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium active:opacity-60'
          >
            <span>#{tag.name}</span>
            {tag.taskCount > 0 && (
              <span className='text-label-2 font-rounded numeric text-footnote'>
                {tag.taskCount}
              </span>
            )}
          </Link>
        ))}
      </div>
    </>
  );
}

function SearchResults({
  search,
  lists,
  onOpen,
}: {
  search: string;
  lists: TaskListResponse[];
  onOpen: (task: TaskResponse) => void;
}) {
  const results = useTasks({ search: search.slice(0, 80) });
  const toggle = useToggleTask();
  const now = useNow();
  const byId = new Map(lists.map((list) => [list.id, list]));

  if (results.isPending) {
    return (
      <TaskCard>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className='flex items-center gap-3 px-4 py-3'>
            <Skeleton className='size-[22px] rounded-full' />
            <Skeleton className='h-4 flex-1' />
          </div>
        ))}
      </TaskCard>
    );
  }

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
        {results.data.map((task) => {
          const list = byId.get(task.listId);
          const color = list ? listColor(list) : 'var(--tint)';
          return (
            <TaskRow
              key={task.id}
              task={task}
              color={color}
              now={now}
              onOpen={onOpen}
              onToggle={toggle}
              extra={
                list && (
                  <span className='inline-flex items-center gap-1'>
                    <span className='size-2 rounded-full' style={{ backgroundColor: color }} />
                    {list.name}
                  </span>
                )
              }
            />
          );
        })}
      </TaskCard>
    </>
  );
}
