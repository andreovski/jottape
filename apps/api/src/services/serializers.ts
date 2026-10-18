import type {
  CategoryResponse,
  EventResponse,
  TaskListResponse,
  TaskResponse,
  TransactionResponse,
} from '@jottape/schemas';
import type {
  Category,
  Event,
  Recurrence,
  Reminder,
  Tag,
  Task,
  TaskList,
  TaskTag,
  Transaction,
} from '@prisma/client';

import { fromDbDate } from '@/lib/dates';

export function toTransaction(
  tx: Transaction & { recurrence?: Pick<Recurrence, 'rrule'> | null }
): TransactionResponse {
  return {
    id: tx.id,
    kind: tx.kind,
    amountCents: tx.amountCents,
    date: fromDbDate(tx.date),
    accountId: tx.accountId,
    toAccountId: tx.toAccountId,
    categoryId: tx.categoryId,
    description: tx.description,
    notes: tx.notes,
    status: tx.status,
    recurrenceId: tx.recurrenceId,
    recurrenceRule: tx.recurrence?.rrule ?? null,
    installmentGroupId: tx.installmentGroupId,
    installmentNumber: tx.installmentNumber,
    installmentTotal: tx.installmentTotal,
    invoiceId: tx.invoiceId,
    paysInvoiceId: tx.paysInvoiceId,
  };
}

export function toCategory(category: Category): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    kind: category.kind,
    parentId: category.parentId,
    icon: category.icon,
    color: category.color,
  };
}

export function toEvent(event: Event, reminders: Reminder[]): EventResponse {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    allDay: event.allDay,
    color: event.color,
    rrule: event.rrule,
    source: event.source,
    calendarId: event.calendarId,
    reminders: reminders.map((r) => r.minutesBefore).sort((a, b) => a - b),
    syncState: event.syncState,
  };
}

export type TaskWithRelations = Task & {
  tags: (TaskTag & { tag: Tag })[];
  subtasks?: TaskWithRelations[];
};

export function toTask(
  task: TaskWithRelations,
  remindersByTask: Map<string, number[]>
): TaskResponse {
  return {
    id: task.id,
    listId: task.listId,
    parentTaskId: task.parentTaskId,
    title: task.title,
    notes: task.notes,
    dueAt: task.dueAt?.toISOString() ?? null,
    hasTime: task.hasTime,
    priority: task.priority,
    rrule: task.rrule,
    completedAt: task.completedAt?.toISOString() ?? null,
    sortOrder: task.sortOrder,
    transactionId: task.transactionId,
    tags: task.tags.map((t) => t.tag.name).sort(),
    reminders: remindersByTask.get(task.id) ?? [],
    googleLinked: Boolean(task.googleTaskId),
    subtasks: (task.subtasks ?? [])
      .filter((s) => !s.deletedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => toTask(s, remindersByTask)),
  };
}

export function toTaskList(list: TaskList, openCount: number): TaskListResponse {
  return {
    id: list.id,
    name: list.name,
    color: list.color,
    icon: list.icon,
    sortOrder: list.sortOrder,
    isInbox: list.isInbox,
    googleLinked: Boolean(list.googleTaskListId),
    openCount,
  };
}
