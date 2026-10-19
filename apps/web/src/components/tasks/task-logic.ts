import {
  buildRRule,
  type Frequency,
  parseSimpleRRule,
  startOfDayInZone,
  wallTimeToInstant,
} from '@jottape/finance-engine';
import type {
  CreateTaskBody,
  TaskListResponse,
  TaskPriority,
  TaskResponse,
  TaskView,
} from '@jottape/schemas';

import { dayKey, relativeDay, time } from '@/lib/format';

// ---------------------------------------------------------------------------------------------
// Listas inteligentes (os quadrados do topo do app Lembretes).

export type SmartSlug = 'hoje' | 'programadas' | 'atrasadas' | 'sem-prazo' | 'todas' | 'concluidas';

export type SmartIcon = 'today' | 'scheduled' | 'overdue' | 'nodate' | 'all' | 'completed';

export interface SmartViewMeta {
  slug: SmartSlug;
  /** Visão da API; `undefined` = todas as tarefas abertas. */
  view: TaskView | undefined;
  title: string;
  color: string;
  icon: SmartIcon;
  /** Mensagem do estado vazio. */
  emptyTitle: string;
}

/**
 * "Todas" é cinza-escuro no claro e cinza médio no escuro (como no Lembretes). A variável é
 * definida por classe na raiz das páginas de Tarefas (`ALL_COLOR_CLASS`).
 */
export const ALL_COLOR = 'var(--tasks-all, var(--gray))';
export const ALL_COLOR_CLASS = '[--tasks-all:#48484a] dark:[--tasks-all:#7c7c80]';

export const SMART_VIEWS: SmartViewMeta[] = [
  {
    slug: 'hoje',
    view: 'today',
    title: 'Hoje',
    color: 'var(--blue)',
    icon: 'today',
    emptyTitle: 'Tudo em dia',
  },
  {
    slug: 'programadas',
    view: 'next7',
    title: 'Programadas',
    color: 'var(--red)',
    icon: 'scheduled',
    emptyTitle: 'Nada programado',
  },
  {
    slug: 'atrasadas',
    view: 'overdue',
    title: 'Atrasadas',
    color: 'var(--orange)',
    icon: 'overdue',
    emptyTitle: 'Nada atrasado',
  },
  {
    slug: 'sem-prazo',
    view: 'nodate',
    title: 'Sem prazo',
    color: 'var(--gray)',
    icon: 'nodate',
    emptyTitle: 'Nenhum lembrete',
  },
  {
    slug: 'todas',
    view: undefined,
    title: 'Todas',
    color: ALL_COLOR,
    icon: 'all',
    emptyTitle: 'Nenhum lembrete',
  },
  {
    slug: 'concluidas',
    view: 'completed',
    title: 'Concluídas',
    color: 'var(--gray)',
    icon: 'completed',
    emptyTitle: 'Nenhum lembrete concluído',
  },
];

export function smartView(param: string): SmartViewMeta | undefined {
  return SMART_VIEWS.find((view) => view.slug === param);
}

export type ListTarget =
  | { kind: 'smart'; meta: SmartViewMeta; tag?: string }
  | { kind: 'list'; id: string; tag?: string };

/** O `$listId` da rota é o id de uma lista ou o nome de uma lista inteligente. */
export function resolveListParam(param: string, tag?: string): ListTarget {
  const meta = smartView(param);
  if (meta) return { kind: 'smart', meta, tag: tag || undefined };
  return { kind: 'list', id: param, tag: tag || undefined };
}

/** A consulta da API para cada destino. */
export function queryForTarget(target: ListTarget) {
  if (target.kind === 'list') return { listId: target.id, tag: target.tag };
  return { view: target.meta.view, tag: target.tag };
}

/** Cor de uma lista (a caixa de entrada é azul, como no Lembretes; as outras, laranja). */
export function listColor(list: Pick<TaskListResponse, 'color' | 'isInbox'>) {
  return list.color ?? (list.isInbox ? 'var(--blue)' : 'var(--orange)');
}

/** Entrada primeiro, depois a ordem do usuário. */
export function sortLists(lists: TaskListResponse[]) {
  return [...lists].sort(
    (a, b) => Number(b.isInbox) - Number(a.isInbox) || a.sortOrder - b.sortOrder
  );
}

// ---------------------------------------------------------------------------------------------
// Prazo e prioridade.

export interface DueInfo {
  label: string;
  overdue: boolean;
  key: string;
}

/** "Hoje", "Amanhã, 14:00", "qua., 22 de out." — vermelho quando passou. */
export function dueInfo(
  task: Pick<TaskResponse, 'dueAt' | 'hasTime' | 'completedAt'>,
  now: Date,
  timeZone?: string
): DueInfo | null {
  if (!task.dueAt) return null;
  const key = dayKey(task.dueAt, timeZone);
  const today = dayKey(now, timeZone);
  const day = relativeDay(key, today);
  const label = task.hasTime ? `${day}, ${time(task.dueAt)}` : day;
  const overdue =
    !task.completedAt &&
    (task.hasTime ? new Date(task.dueAt).getTime() < now.getTime() : key < today);
  return { label, overdue, key };
}

export function priorityMark(priority: TaskPriority | null | undefined) {
  if (priority === 'HIGH') return '!!!';
  if (priority === 'MEDIUM') return '!!';
  if (priority === 'LOW') return '!';
  return '';
}

// ---------------------------------------------------------------------------------------------
// Ordem e agrupamento.

/** Move `activeId` para a posição de `overId` (o que o arrastar faz). */
export function moveId(ids: string[], activeId: string, overId: string) {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

/** Aplica uma ordem local (enquanto o servidor grava) sobre a lista que veio da API. */
export function applyOrder<T extends { id: string }>(items: T[], order: string[] | null) {
  if (!order) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const rest = items.filter((item) => !order.includes(item.id));
  return [...ordered, ...rest];
}

/** Subtarefas mostradas na lista: só as abertas (na visão de concluídas, todas). */
export function visibleSubtasks(task: TaskResponse, showCompleted: boolean) {
  return showCompleted ? task.subtasks : task.subtasks.filter((sub) => !sub.completedAt);
}

export interface TaskGroup {
  id: string;
  title: string;
  color?: string;
  tasks: TaskResponse[];
}

/** "Programadas" agrupa por dia; "Todas" agrupa por lista, como no Lembretes. */
export function groupTasks(
  tasks: TaskResponse[],
  mode: 'day' | 'list',
  options: { lists?: TaskListResponse[]; today: string; timeZone?: string }
): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  if (mode === 'list') {
    for (const list of sortLists(options.lists ?? [])) {
      groups.set(list.id, { id: list.id, title: list.name, color: listColor(list), tasks: [] });
    }
  }
  for (const task of tasks) {
    let id: string;
    let title: string;
    if (mode === 'day') {
      id = task.dueAt ? dayKey(task.dueAt, options.timeZone) : 'sem-data';
      title = task.dueAt ? relativeDay(id, options.today) : 'Sem data';
    } else {
      id = task.listId;
      title = 'Outra lista';
    }
    let group = groups.get(id);
    if (!group) {
      group = { id, title, tasks: [] };
      groups.set(id, group);
    }
    group.tasks.push(task);
  }
  const result = [...groups.values()].filter((group) => group.tasks.length > 0);
  if (mode === 'day') result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

// ---------------------------------------------------------------------------------------------
// Etiquetas.

export function normalizeTag(raw: string) {
  return raw.trim().replace(/^#+/, '').trim().replace(/\s+/g, '-').slice(0, 30);
}

/** Acrescenta uma etiqueta (sem repetir, sem diferenciar maiúsculas; no máximo 10). */
export function addTag(tags: string[], raw: string) {
  const tag = normalizeTag(raw);
  if (!tag || tags.length >= 10) return tags;
  if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return tags;
  return [...tags, tag];
}

// ---------------------------------------------------------------------------------------------
// Formulário do lembrete.

export const REPEAT_OPTIONS: { value: '' | Frequency; label: string }[] = [
  { value: '', label: 'Nunca' },
  { value: 'DAILY', label: 'Diariamente' },
  { value: 'WEEKLY', label: 'Semanalmente' },
  { value: 'MONTHLY', label: 'Mensalmente' },
  { value: 'YEARLY', label: 'Anualmente' },
];

export const REMINDER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Nenhum' },
  { value: '0', label: 'Na hora' },
  { value: '10', label: '10 min antes' },
  { value: '30', label: '30 min antes' },
  { value: '60', label: '1 h antes' },
  { value: '1440', label: '1 dia antes' },
];

export function reminderLabel(minutes: number) {
  const known = REMINDER_OPTIONS.find((option) => option.value === String(minutes));
  if (known) return known.label;
  if (minutes % 1440 === 0) return `${minutes / 1440} dias antes`;
  if (minutes % 60 === 0) return `${minutes / 60} h antes`;
  return `${minutes} min antes`;
}

/** Opções de lembrete, incluindo um valor que veio de fora (Google, outro app). */
export function reminderOptions(current: string) {
  if (!current || REMINDER_OPTIONS.some((option) => option.value === current)) {
    return REMINDER_OPTIONS;
  }
  return [...REMINDER_OPTIONS, { value: current, label: reminderLabel(Number(current)) }];
}

/** A regra simples ("FREQ=WEEKLY") vira a opção do seletor; regra complexa é preservada. */
export function repeatValue(rrule: string | null): string {
  if (!rrule) return '';
  const parsed = parseSimpleRRule(rrule);
  if (
    parsed &&
    !parsed.byWeekday?.length &&
    !parsed.count &&
    !parsed.until &&
    (!parsed.interval || parsed.interval === 1)
  ) {
    return parsed.freq;
  }
  return rrule;
}

export interface TaskForm {
  title: string;
  notes: string;
  hasDate: boolean;
  date: string;
  hasTime: boolean;
  time: string;
  /** '' | frequência simples | regra completa preservada. */
  repeat: string;
  /** '' ou minutos antes. */
  reminder: string;
  tags: string[];
  priority: TaskPriority | null;
  listId: string;
}

export function formFromTask(
  task: TaskResponse | null,
  defaults: { listId: string; today: string; date?: string; tags?: string[] },
  timeZone?: string
): TaskForm {
  if (!task) {
    return {
      title: '',
      notes: '',
      hasDate: Boolean(defaults.date),
      date: defaults.date ?? defaults.today,
      hasTime: false,
      time: '09:00',
      repeat: '',
      reminder: '',
      tags: defaults.tags ?? [],
      priority: null,
      listId: defaults.listId,
    };
  }
  const hasDate = Boolean(task.dueAt);
  return {
    title: task.title,
    notes: task.notes ?? '',
    hasDate,
    date: task.dueAt ? dayKey(task.dueAt, timeZone) : defaults.today,
    hasTime: hasDate && task.hasTime,
    time: task.dueAt && task.hasTime ? wallClock(task.dueAt, timeZone) : '09:00',
    repeat: repeatValue(task.rrule),
    reminder: task.reminders.length ? String(task.reminders[0]) : '',
    tags: task.tags,
    priority: task.priority,
    listId: task.listId,
  };
}

function wallClock(instant: string, timeZone?: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

export function dueFromForm(
  form: Pick<TaskForm, 'hasDate' | 'date' | 'hasTime' | 'time'>,
  timeZone: string
) {
  if (!form.hasDate || !form.date) return { dueAt: null, hasTime: false };
  if (!form.hasTime || !form.time) {
    return { dueAt: startOfDayInZone(form.date, timeZone).toISOString(), hasTime: false };
  }
  const [year, month, day] = form.date.split('-').map(Number);
  const [hour, minute] = form.time.split(':').map(Number);
  return {
    dueAt: wallTimeToInstant({ year, month, day, hour, minute }, timeZone).toISOString(),
    hasTime: true,
  };
}

/** O corpo da API a partir do formulário (o mesmo para criar e editar). */
export function bodyFromForm(form: TaskForm, timeZone: string) {
  const due = dueFromForm(form, timeZone);
  const rrule =
    !due.dueAt || !form.repeat
      ? null
      : form.repeat.startsWith('FREQ=')
        ? form.repeat
        : buildRRule({ freq: form.repeat as Frequency });
  return {
    title: form.title.trim(),
    notes: form.notes.trim() || null,
    dueAt: due.dueAt,
    hasTime: due.hasTime,
    rrule,
    reminders: due.dueAt && form.reminder !== '' ? [Number(form.reminder)] : [],
    tags: form.tags,
    priority: form.priority,
    listId: form.listId || undefined,
  } satisfies CreateTaskBody;
}

/** O que a adição rápida cria em cada lista. */
export function quickAddBody(
  title: string,
  target: ListTarget,
  options: { today: string; timeZone: string }
): CreateTaskBody {
  const body: CreateTaskBody = { title: title.trim() };
  if (target.kind === 'list') {
    body.listId = target.id;
    if (target.tag) body.tags = [target.tag];
    return body;
  }
  if (target.meta.slug === 'hoje' || target.meta.slug === 'programadas') {
    body.dueAt = startOfDayInZone(options.today, options.timeZone).toISOString();
    body.hasTime = false;
  }
  if (target.tag) body.tags = [target.tag];
  return body;
}

/** A adição rápida não aparece onde o lembrete novo sumiria na hora. */
export function canQuickAdd(target: ListTarget) {
  return target.kind === 'list' || !['atrasadas', 'concluidas'].includes(target.meta.slug);
}

/** Procura uma tarefa (ou subtarefa) pelo id nas listas carregadas. */
export function findTask(groups: (TaskResponse[] | undefined)[], id: string | null) {
  if (!id) return null;
  for (const tasks of groups) {
    for (const task of tasks ?? []) {
      if (task.id === id) return task;
      const sub = task.subtasks.find((s) => s.id === id);
      if (sub) return sub;
    }
  }
  return null;
}
