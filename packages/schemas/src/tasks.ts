import { z } from 'zod';

import { colorSchema, idSchema, isoDateTimeSchema, remindersSchema, rruleSchema } from './common';

export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
};

export const createTaskListBodySchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(60),
  color: colorSchema,
  icon: z.string().max(40).nullable().optional(),
});
export type CreateTaskListBody = z.infer<typeof createTaskListBodySchema>;

export const updateTaskListBodySchema = createTaskListBodySchema
  .partial()
  .extend({ sortOrder: z.number().int().optional() });
export type UpdateTaskListBody = z.infer<typeof updateTaskListBodySchema>;

export const taskListResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  isInbox: z.boolean(),
  googleLinked: z.boolean(),
  openCount: z.number().int(),
});
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;

const taskFields = {
  title: z.string().trim().min(1, 'Informe o título.').max(300),
  /** Sem lista, vai para a caixa de entrada. */
  listId: idSchema.optional(),
  parentTaskId: idSchema.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  dueAt: isoDateTimeSchema.nullable().optional(),
  /** false = prazo só com dia (dueAt é meia-noite no fuso do usuário). */
  hasTime: z.boolean().optional(),
  priority: taskPrioritySchema.nullable().optional(),
  rrule: rruleSchema.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  reminders: remindersSchema.optional(),
  transactionId: idSchema.nullable().optional(),
};

export const createTaskBodySchema = z.object(taskFields);
export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;

export const updateTaskBodySchema = z
  .object(taskFields)
  .partial()
  .extend({ completed: z.boolean().optional() });
export type UpdateTaskBody = z.infer<typeof updateTaskBodySchema>;

export const taskViewSchema = z.enum(['today', 'next7', 'overdue', 'nodate', 'completed']);
export type TaskView = z.infer<typeof taskViewSchema>;

export const TASK_VIEW_LABELS: Record<TaskView, string> = {
  today: 'Hoje',
  next7: 'Próximos 7 dias',
  overdue: 'Atrasadas',
  nodate: 'Sem prazo',
  completed: 'Concluídas',
};

export const listTasksQuerySchema = z.object({
  view: taskViewSchema.optional(),
  listId: idSchema.optional(),
  tag: z.string().optional(),
  search: z.string().max(80).optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const reorderTasksBodySchema = z.object({
  listId: idSchema,
  orderedIds: z.array(idSchema).min(1).max(1000),
});
export type ReorderTasksBody = z.infer<typeof reorderTasksBodySchema>;

export interface TaskResponse {
  id: string;
  listId: string;
  parentTaskId: string | null;
  title: string;
  notes: string | null;
  dueAt: string | null;
  hasTime: boolean;
  priority: TaskPriority | null;
  rrule: string | null;
  completedAt: string | null;
  sortOrder: number;
  transactionId: string | null;
  tags: string[];
  reminders: number[];
  googleLinked: boolean;
  subtasks: TaskResponse[];
}

export const completeTaskResponseSchema = z.object({
  task: z.custom<TaskResponse>(),
  /** Próxima ocorrência criada ao concluir uma tarefa recorrente. */
  next: z.custom<TaskResponse>().nullable(),
  /** Lançamento ligado ainda previsto: o app oferece marcar como pago. */
  linkedPlannedTransactionId: z.string().nullable(),
});
export type CompleteTaskResponse = z.infer<typeof completeTaskResponseSchema>;

export const tagResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  taskCount: z.number().int(),
});
export type TagResponse = z.infer<typeof tagResponseSchema>;
