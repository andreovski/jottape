import type { TaskPriority, TaskResponse } from '@jottape/schemas';
import { Bell, Calendar, Clock, Flag, Hash, List, Plus, Repeat, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button, CheckCircle, Pill, Segmented, Switch } from '@/components/ios/controls';
import {
  DateInput,
  FieldRow,
  SelectInput,
  TextArea,
  TextInput,
  TimeInput,
} from '@/components/ios/fields';
import { IconChip, Row, Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import { useMe } from '@/features/auth';
import {
  useCreateTask,
  useDeleteTask,
  useTags,
  useTaskLists,
  useTasks,
  useUpdateTask,
} from '@/features/tasks';
import { appTimeZone, relativeDay, todayKey } from '@/lib/format';
import { cn } from '@/lib/utils';

import {
  addTag,
  bodyFromForm,
  findTask,
  formFromTask,
  listColor,
  reminderOptions,
  REPEAT_OPTIONS,
  sortLists,
  type TaskForm,
} from './task-logic';
import { useToggleTask } from './task-row';

export interface TaskSheetDefaults {
  listId?: string;
  /** "AAAA-MM-DD": já começa com a data ligada. */
  date?: string;
  tags?: string[];
}

const PRIORITIES: { value: 'NONE' | TaskPriority; label: string }[] = [
  { value: 'NONE', label: 'Nenhuma' },
  { value: 'LOW', label: 'Baixa' },
  { value: 'MEDIUM', label: 'Média' },
  { value: 'HIGH', label: 'Alta' },
];

/**
 * Detalhes do lembrete ("Cancelar · Detalhes · OK") — também é a folha de criar ("Novo Lembrete ·
 * Adicionar"). Monte com uma `key` nova a cada abertura para o formulário começar limpo.
 */
export function TaskSheet({
  open,
  onOpenChange,
  task: snapshot,
  defaults = {},
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskResponse | null;
  defaults?: TaskSheetDefaults;
}) {
  const lists = useTaskLists();
  const me = useMe();
  const tags = useTags();
  const create = useCreateTask();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const toggleTask = useToggleTask();

  // A tarefa mais recente da lista (subtarefas novas aparecem sem fechar a folha).
  const fresh = useTasks({ listId: snapshot?.listId ?? defaults.listId });
  const task = snapshot ? (findTask([fresh.data], snapshot.id) ?? snapshot) : null;

  const sortedLists = sortLists(lists.data ?? []);
  const inboxId = sortedLists.find((list) => list.isInbox)?.id ?? '';
  const isSubtask = Boolean(task?.parentTaskId);

  const [form, setForm] = useState<TaskForm>(() =>
    formFromTask(snapshot, { today: todayKey(), ...defaults, listId: defaults.listId ?? '' })
  );
  const [tagDraft, setTagDraft] = useState('');
  const [subDraft, setSubDraft] = useState('');
  const [pendingSubs, setPendingSubs] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const patch = (changes: Partial<TaskForm>) => setForm((current) => ({ ...current, ...changes }));
  const listId = form.listId || inboxId;
  const selectedList = sortedLists.find((list) => list.id === listId);

  function commitTag() {
    if (!tagDraft.trim()) return;
    patch({ tags: addTag(form.tags, tagDraft) });
    setTagDraft('');
  }

  async function save() {
    if (!form.title.trim()) return;
    const finalForm = tagDraft.trim() ? { ...form, tags: addTag(form.tags, tagDraft) } : form;
    const body = bodyFromForm({ ...finalForm, listId }, appTimeZone());
    setSaving(true);
    try {
      if (task) {
        const { listId: nextListId, ...rest } = body;
        await update.mutateAsync({
          id: task.id,
          ...rest,
          ...(isSubtask || nextListId === task.listId ? {} : { listId: nextListId }),
        });
      } else {
        const created = await create.mutateAsync(body);
        const subs = [...pendingSubs, subDraft].map((title) => title.trim()).filter(Boolean);
        for (const title of subs) {
          await create.mutateAsync({ title, parentTaskId: created.id, listId: created.listId });
        }
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  async function addSubtask() {
    const title = subDraft.trim();
    if (!title) return;
    setSubDraft('');
    if (!task) {
      setPendingSubs((current) => [...current, title]);
      return;
    }
    await create.mutateAsync({ title, parentTaskId: task.id, listId: task.listId });
  }

  const tagSuggestions = (tags.data ?? [])
    .map((tag) => tag.name)
    .filter(
      (name) =>
        !form.tags.some((tag) => tag.toLowerCase() === name.toLowerCase()) &&
        name.toLowerCase().includes(tagDraft.trim().replace(/^#/, '').toLowerCase())
    )
    .slice(0, 8);

  const dateLabel = form.hasDate ? relativeDay(form.date) : null;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      tall
      title={task ? 'Detalhes' : 'Novo Lembrete'}
      confirmLabel={task ? 'OK' : 'Adicionar'}
      confirmDisabled={!form.title.trim() || saving}
      onConfirm={save}
    >
      <Section>
        <FieldRow>
          <TextInput
            aria-label='Título'
            placeholder='Título'
            autoFocus={!task}
            value={form.title}
            onChange={(event) => patch({ title: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) save();
            }}
          />
        </FieldRow>
        <FieldRow>
          <TextArea
            aria-label='Notas'
            placeholder='Notas'
            rows={2}
            value={form.notes}
            onChange={(event) => patch({ notes: event.target.value })}
          />
        </FieldRow>
      </Section>

      <Section>
        <Row
          leading={
            <IconChip color='var(--red)'>
              <Calendar strokeWidth={2.25} />
            </IconChip>
          }
          title='Data'
          subtitle={dateLabel && <span className='text-tint'>{dateLabel}</span>}
          trailing={
            <Switch
              label='Data'
              checked={form.hasDate}
              onChange={(hasDate) =>
                patch(
                  hasDate ? { hasDate, date: form.date || todayKey() } : { hasDate, hasTime: false }
                )
              }
            />
          }
        />
        {form.hasDate && (
          <FieldRow label='Dia'>
            <DateInput
              value={form.date}
              onChange={(event) => patch({ date: event.target.value || todayKey() })}
            />
          </FieldRow>
        )}
        {form.hasDate && (
          <Row
            leading={
              <IconChip color='var(--blue)'>
                <Clock strokeWidth={2.25} />
              </IconChip>
            }
            title='Horário'
            subtitle={form.hasTime && <span className='text-tint numeric'>{form.time}</span>}
            trailing={
              <Switch
                label='Horário'
                checked={form.hasTime}
                onChange={(hasTime) => {
                  const changes: Partial<TaskForm> = { hasTime };
                  const preferred = me.data?.defaultReminderMin;
                  if (hasTime && !task && form.reminder === '' && preferred != null) {
                    changes.reminder = String(preferred);
                  }
                  patch(changes);
                }}
              />
            }
          />
        )}
        {form.hasDate && form.hasTime && (
          <FieldRow label='Hora'>
            <TimeInput
              value={form.time}
              onChange={(event) => patch({ time: event.target.value || '09:00' })}
            />
          </FieldRow>
        )}
        {form.hasDate && (
          <Row
            leading={
              <IconChip color='var(--gray)'>
                <Repeat strokeWidth={2.25} />
              </IconChip>
            }
            title='Repetir'
            trailing={
              <SelectInput
                value={form.repeat}
                onChange={(repeat) => patch({ repeat })}
                options={
                  form.repeat.startsWith('FREQ=')
                    ? [...REPEAT_OPTIONS, { value: form.repeat, label: 'Personalizado' }]
                    : REPEAT_OPTIONS
                }
              />
            }
          />
        )}
        {form.hasDate && (
          <Row
            leading={
              <IconChip color='var(--purple)'>
                <Bell strokeWidth={2.25} />
              </IconChip>
            }
            title='Lembrete'
            trailing={
              <SelectInput
                value={form.reminder}
                onChange={(reminder) => patch({ reminder })}
                options={reminderOptions(form.reminder)}
              />
            }
          />
        )}
      </Section>

      <Section>
        <div className='group/row flex w-full items-start gap-3 pl-4'>
          <div className='flex shrink-0 items-center py-2'>
            <IconChip color='var(--gray)'>
              <Hash strokeWidth={2.5} />
            </IconChip>
          </div>
          <div className='min-w-0 flex-1 py-2.5 pr-4 shadow-[inset_0_-0.5px_0_var(--separator)]'>
            <div className='text-body'>Etiquetas</div>
            <div className='mt-2 flex flex-wrap items-center gap-1.5'>
              {form.tags.map((tag) => (
                <button
                  key={tag}
                  type='button'
                  onClick={() => patch({ tags: form.tags.filter((t) => t !== tag) })}
                  className='bg-tint/15 text-tint text-subhead inline-flex h-7 items-center gap-1 rounded-full pr-2 pl-2.5 font-medium active:opacity-60'
                  aria-label={`Remover etiqueta ${tag}`}
                >
                  #{tag}
                  <X className='size-3.5' strokeWidth={2.5} />
                </button>
              ))}
              {form.tags.length < 10 && (
                <input
                  aria-label='Nova etiqueta'
                  placeholder={form.tags.length ? 'Adicionar' : 'Adicionar etiqueta'}
                  value={tagDraft}
                  enterKeyHint='done'
                  onChange={(event) => {
                    const value = event.target.value;
                    if (/[,\s]$/.test(value) && value.trim()) {
                      patch({ tags: addTag(form.tags, value) });
                      setTagDraft('');
                    } else {
                      setTagDraft(value);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      commitTag();
                    } else if (event.key === 'Backspace' && !tagDraft && form.tags.length) {
                      patch({ tags: form.tags.slice(0, -1) });
                    }
                  }}
                  onBlur={commitTag}
                  className='text-subhead placeholder:text-label-3 h-7 min-w-24 flex-1 bg-transparent outline-none'
                />
              )}
            </div>
            {tagSuggestions.length > 0 && (tagDraft || form.tags.length === 0) && (
              <div className='no-scrollbar -mr-4 mt-2 flex gap-1.5 overflow-x-auto pr-4'>
                {tagSuggestions.map((name) => (
                  <button
                    key={name}
                    type='button'
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      patch({ tags: addTag(form.tags, name) });
                      setTagDraft('');
                    }}
                    className='shrink-0 active:opacity-60'
                  >
                    <Pill>#{name}</Pill>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className='group/row flex w-full items-start gap-3 pl-4'>
          <div className='flex shrink-0 items-center py-2'>
            <IconChip color='var(--red)'>
              <Flag strokeWidth={2.25} />
            </IconChip>
          </div>
          <div className='min-w-0 flex-1 py-2.5 pr-4 shadow-[inset_0_-0.5px_0_var(--separator)] group-last/row:shadow-none'>
            <div className='text-body mb-2'>Prioridade</div>
            <Segmented
              value={form.priority ?? 'NONE'}
              onChange={(value) => patch({ priority: value === 'NONE' ? null : value })}
              options={PRIORITIES}
            />
          </div>
        </div>

        {!isSubtask && (
          <Row
            leading={
              <IconChip color={selectedList ? listColor(selectedList) : 'var(--orange)'} round>
                <List strokeWidth={2.5} />
              </IconChip>
            }
            title='Lista'
            trailing={
              <SelectInput
                value={listId}
                onChange={(value) => patch({ listId: value })}
                options={sortedLists.map((list) => ({ value: list.id, label: list.name }))}
              />
            }
          />
        )}
      </Section>

      {!isSubtask && (
        <Section header='Subtarefas'>
          {task?.subtasks.map((sub) => (
            <div key={sub.id} className='group/row flex items-center gap-2.5 pl-3'>
              <CheckCircle
                checked={Boolean(sub.completedAt)}
                onChange={() => toggleTask(sub)}
                color={selectedList ? listColor(selectedList) : undefined}
                label={sub.completedAt ? `Reabrir ${sub.title}` : `Concluir ${sub.title}`}
              />
              <div className='flex min-h-11 min-w-0 flex-1 items-center gap-2 pr-2 shadow-[inset_0_-0.5px_0_var(--separator)]'>
                <span
                  className={cn(
                    'text-body min-w-0 flex-1 truncate',
                    sub.completedAt && 'text-label-2'
                  )}
                >
                  {sub.title}
                </span>
                <button
                  type='button'
                  aria-label={`Apagar ${sub.title}`}
                  onClick={() => remove.mutate(sub.id)}
                  className='text-label-3 flex size-8 items-center justify-center active:opacity-50'
                >
                  <X className='size-4' strokeWidth={2.5} />
                </button>
              </div>
            </div>
          ))}
          {pendingSubs.map((title, index) => (
            <div key={`${title}-${index}`} className='group/row flex items-center gap-2.5 pl-3'>
              <CheckCircle checked={false} onChange={() => undefined} label={title} />
              <div className='flex min-h-11 min-w-0 flex-1 items-center gap-2 pr-2 shadow-[inset_0_-0.5px_0_var(--separator)]'>
                <span className='text-body min-w-0 flex-1 truncate'>{title}</span>
                <button
                  type='button'
                  aria-label={`Remover ${title}`}
                  onClick={() => setPendingSubs((current) => current.filter((_, i) => i !== index))}
                  className='text-label-3 flex size-8 items-center justify-center active:opacity-50'
                >
                  <X className='size-4' strokeWidth={2.5} />
                </button>
              </div>
            </div>
          ))}
          <label className='flex min-h-11 items-center gap-2.5 pl-3'>
            <span className='text-tint flex size-7 shrink-0 items-center justify-center'>
              <Plus className='size-5' strokeWidth={2.5} />
            </span>
            <input
              placeholder='Adicionar subtarefa'
              value={subDraft}
              enterKeyHint='done'
              onChange={(event) => setSubDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  addSubtask();
                }
              }}
              className='text-body placeholder:text-label-3 min-w-0 flex-1 bg-transparent py-2.5 pr-4 outline-none'
            />
          </label>
        </Section>
      )}

      {task && (
        <Button
          variant='destructive'
          className='w-full'
          loading={remove.isPending}
          onClick={async () => {
            await remove.mutateAsync(task.id);
            onOpenChange(false);
            toast('Lembrete apagado');
          }}
        >
          Apagar lembrete
        </Button>
      )}
    </Sheet>
  );
}
