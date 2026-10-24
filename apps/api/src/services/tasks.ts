import { addDays, eventOccurrences, startOfDayInZone } from '@jottape/finance-engine';
import type {
  CompleteTaskResponse,
  CreateTaskBody,
  ListTasksQuery,
  TaskResponse,
  UpdateTaskBody,
} from '@jottape/schemas';
import type { Prisma } from '@prisma/client';

import { todayIn } from '@/lib/dates';
import { AppError, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

import { userTimezone } from './finance';
import { deleteTaskFromGoogle, pushTaskToGoogle } from './google/tasks';
import { deleteReminders, refreshReminders, remindersByOwner, setReminders } from './reminders';
import { type TaskWithRelations, toTask } from './serializers';

export const taskInclude = {
  tags: { include: { tag: true } },
  subtasks: { include: { tags: { include: { tag: true } } } },
} satisfies Prisma.TaskInclude;

async function serialize(tasks: TaskWithRelations[]): Promise<TaskResponse[]> {
  const ids = tasks.flatMap((t) => [t.id, ...(t.subtasks ?? []).map((s) => s.id)]);
  const reminders = await remindersByOwner('TASK', ids);
  return tasks.map((task) => toTask(task, reminders));
}

export async function inboxId(userId: string): Promise<string> {
  const inbox = await prisma.taskList.findFirst({ where: { userId, isInbox: true } });
  if (inbox) return inbox.id;
  return (await prisma.taskList.create({ data: { userId, name: 'Entrada', isInbox: true } })).id;
}

export async function getTask(userId: string, id: string): Promise<TaskResponse> {
  const task = await prisma.task.findFirst({
    where: { id, userId, deletedAt: null },
    include: taskInclude,
  });
  if (!task) throw notFound('Tarefa');
  return (await serialize([task]))[0];
}

/** Intervalo do dia de hoje no fuso do usuário. */
function todayBounds(timeZone: string, now = new Date()) {
  const today = todayIn(timeZone, now);
  return {
    start: startOfDayInZone(today, timeZone),
    end: startOfDayInZone(addDays(today, 1), timeZone),
    in7: startOfDayInZone(addDays(today, 7), timeZone),
  };
}

export async function listTasks(userId: string, query: ListTasksQuery) {
  const timeZone = await userTimezone(userId);
  const now = new Date();
  const { start, end, in7 } = todayBounds(timeZone, now);

  const where: Prisma.TaskWhereInput = { userId, deletedAt: null, parentTaskId: null };
  if (query.listId) where.listId = query.listId;
  if (query.tag) where.tags = { some: { tag: { name: query.tag } } };
  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { notes: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  let orderBy: Prisma.TaskOrderByWithRelationInput[] = [{ sortOrder: 'asc' }, { createdAt: 'asc' }];

  switch (query.view) {
    case 'today':
      Object.assign(where, { completedAt: null, dueAt: { lt: end } });
      orderBy = [{ dueAt: 'asc' }, { sortOrder: 'asc' }];
      break;
    case 'next7':
      Object.assign(where, { completedAt: null, dueAt: { gte: start, lt: in7 } });
      orderBy = [{ dueAt: 'asc' }, { sortOrder: 'asc' }];
      break;
    case 'overdue':
      Object.assign(where, {
        completedAt: null,
        AND: [{ OR: [{ dueAt: { lt: start } }, { hasTime: true, dueAt: { lt: now } }] }],
      });
      orderBy = [{ dueAt: 'asc' }];
      break;
    case 'nodate':
      Object.assign(where, { completedAt: null, dueAt: null });
      break;
    case 'completed':
      where.completedAt = { not: null };
      orderBy = [{ completedAt: 'desc' }];
      break;
    default:
      where.completedAt = null;
  }

  const tasks = await prisma.task.findMany({
    where,
    include: taskInclude,
    orderBy,
    take: query.view === 'completed' ? 200 : 1000,
  });
  return serialize(tasks);
}

async function syncTags(userId: string, taskId: string, names: string[]) {
  const unique = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  const tags = [];
  for (const name of unique) {
    tags.push(
      await prisma.tag.upsert({
        where: { userId_name: { userId, name } },
        update: {},
        create: { userId, name },
      })
    );
  }
  await prisma.taskTag.deleteMany({ where: { taskId } });
  if (tags.length) {
    await prisma.taskTag.createMany({ data: tags.map((tag) => ({ taskId, tagId: tag.id })) });
  }
}

async function resolveList(
  userId: string,
  body: { listId?: string; parentTaskId?: string | null }
) {
  if (body.parentTaskId) {
    const parent = await prisma.task.findFirst({ where: { id: body.parentTaskId, userId } });
    if (!parent) throw notFound('Tarefa-mãe');
    if (parent.parentTaskId) throw new AppError(400, 'Subtarefas vão até um nível só.');
    return parent.listId;
  }
  if (body.listId) {
    const list = await prisma.taskList.findFirst({ where: { id: body.listId, userId } });
    if (!list) throw notFound('Lista');
    return list.id;
  }
  return inboxId(userId);
}

async function assertTransaction(userId: string, id: string | null | undefined) {
  if (!id) return;
  if (!(await prisma.transaction.findFirst({ where: { id, userId }, select: { id: true } }))) {
    throw notFound('Lançamento');
  }
}

export async function createTask(userId: string, body: CreateTaskBody): Promise<TaskResponse> {
  const listId = await resolveList(userId, body);
  await assertTransaction(userId, body.transactionId);
  const last = await prisma.task.findFirst({
    where: { listId, parentTaskId: body.parentTaskId ?? null },
    orderBy: { sortOrder: 'desc' },
  });

  const task = await prisma.task.create({
    data: {
      userId,
      listId,
      parentTaskId: body.parentTaskId ?? null,
      title: body.title,
      notes: body.notes ?? null,
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
      hasTime: body.dueAt ? (body.hasTime ?? false) : false,
      priority: body.priority ?? null,
      rrule: body.rrule ?? null,
      transactionId: body.transactionId ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      syncState: 'PENDING',
    },
  });

  if (body.tags?.length) await syncTags(userId, task.id, body.tags);
  if (body.reminders?.length) await setReminders(userId, 'TASK', task.id, body.reminders);

  await pushTaskToGoogle(task.id);
  return getTask(userId, task.id);
}

export async function updateTask(userId: string, id: string, body: UpdateTaskBody) {
  const task = await prisma.task.findFirst({ where: { id, userId, deletedAt: null } });
  if (!task) throw notFound('Tarefa');
  const { completed, tags, reminders, listId, parentTaskId, ...fields } = body;

  const data: Prisma.TaskUncheckedUpdateInput = { syncState: 'PENDING' };
  if (fields.title !== undefined) data.title = fields.title;
  if (fields.notes !== undefined) data.notes = fields.notes;
  if (fields.priority !== undefined) data.priority = fields.priority;
  if (fields.rrule !== undefined) data.rrule = fields.rrule;
  if (fields.transactionId !== undefined) {
    await assertTransaction(userId, fields.transactionId);
    data.transactionId = fields.transactionId;
  }
  if (fields.dueAt !== undefined) {
    data.dueAt = fields.dueAt ? new Date(fields.dueAt) : null;
    if (!fields.dueAt) data.hasTime = false;
  }
  if (fields.hasTime !== undefined && (fields.dueAt ?? task.dueAt)) data.hasTime = fields.hasTime;

  if (listId !== undefined && listId !== task.listId) {
    if (task.parentTaskId) throw new AppError(400, 'Mova a tarefa-mãe para trocar a lista.');
    data.listId = await resolveList(userId, { listId });
    // Trocar de lista no Google Tasks não existe: a tarefa é recriada na outra lista.
    if (task.googleTaskId) {
      await deleteTaskFromGoogle({ ...task, deletedAt: null }, { keepLocal: true });
      data.googleTaskId = null;
      data.googleEtag = null;
    }
    await prisma.task.updateMany({
      where: { parentTaskId: id },
      data: { listId: data.listId as string },
    });
  }
  if (parentTaskId !== undefined && parentTaskId !== task.parentTaskId) {
    if (parentTaskId === id) throw new AppError(400, 'A tarefa não pode ser mãe de si mesma.');
    data.parentTaskId = parentTaskId;
    if (parentTaskId) data.listId = await resolveList(userId, { parentTaskId });
  }

  await prisma.task.update({ where: { id }, data });
  if (tags) await syncTags(userId, id, tags);
  if (reminders) await setReminders(userId, 'TASK', id, reminders);

  if (completed === true && !task.completedAt) {
    await completeTask(userId, id);
  } else if (completed === false && task.completedAt) {
    await prisma.task.update({ where: { id }, data: { completedAt: null } });
  }

  await refreshReminders('TASK', id);
  await pushTaskToGoogle(id);
  return getTask(userId, id);
}

/** Próximo prazo de uma tarefa recorrente, depois do prazo atual (ou de hoje, se não tinha). */
function nextDue(rrule: string, dueAt: Date, timeZone: string): Date | null {
  const horizon = new Date(dueAt.getTime() + 3 * 366 * 86_400_000);
  return (
    eventOccurrences(rrule, dueAt, new Date(dueAt.getTime() + 1), horizon, timeZone).find(
      (d) => d.getTime() > dueAt.getTime()
    ) ?? null
  );
}

export async function completeTask(userId: string, id: string): Promise<CompleteTaskResponse> {
  const task = await prisma.task.findFirst({
    where: { id, userId, deletedAt: null },
    include: taskInclude,
  });
  if (!task) throw notFound('Tarefa');

  let nextId: string | null = null;
  if (!task.completedAt) {
    await prisma.task.update({
      where: { id },
      data: { completedAt: new Date(), syncState: 'PENDING' },
    });

    if (task.rrule && task.dueAt) {
      const timeZone = await userTimezone(userId);
      const due = nextDue(task.rrule, task.dueAt, timeZone);
      if (due) {
        const next = await prisma.task.create({
          data: {
            userId,
            listId: task.listId,
            title: task.title,
            notes: task.notes,
            dueAt: due,
            hasTime: task.hasTime,
            priority: task.priority,
            rrule: task.rrule,
            sortOrder: task.sortOrder,
            syncState: 'PENDING',
            subtasks: {
              create: task.subtasks
                .filter((s) => !s.deletedAt)
                .map((s) => ({
                  userId,
                  listId: task.listId,
                  title: s.title,
                  notes: s.notes,
                  sortOrder: s.sortOrder,
                  syncState: 'PENDING' as const,
                })),
            },
          },
        });
        await syncTags(
          userId,
          next.id,
          task.tags.map((t) => t.tag.name)
        );
        const reminders = await remindersByOwner('TASK', [task.id]);
        if (reminders.get(task.id)?.length) {
          await setReminders(userId, 'TASK', next.id, reminders.get(task.id)!);
        }
        nextId = next.id;
        await pushTaskToGoogle(next.id);
      }
    }
    await refreshReminders('TASK', id);
    await pushTaskToGoogle(id);
  }

  let linkedPlannedTransactionId: string | null = null;
  if (task.transactionId) {
    const tx = await prisma.transaction.findUnique({ where: { id: task.transactionId } });
    if (tx?.status === 'PLANNED') linkedPlannedTransactionId = tx.id;
  }

  return {
    task: await getTask(userId, id),
    next: nextId ? await getTask(userId, nextId) : null,
    linkedPlannedTransactionId,
  };
}

export async function deleteTask(userId: string, id: string) {
  const task = await prisma.task.findFirst({
    where: { id, userId, deletedAt: null },
    include: { subtasks: true },
  });
  if (!task) throw notFound('Tarefa');
  const ids = [id, ...task.subtasks.map((s) => s.id)];
  await deleteReminders('TASK', ids);

  if (task.googleTaskId) {
    // Fica marcada até o Google confirmar; o sync tenta de novo se falhar.
    await prisma.task.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
    await deleteTaskFromGoogle({ ...task, deletedAt: new Date() });
  } else {
    await prisma.task.delete({ where: { id } });
  }
}

export async function reorderTasks(userId: string, listId: string, orderedIds: string[]) {
  const tasks = await prisma.task.findMany({
    where: { id: { in: orderedIds }, userId, listId },
    select: { id: true },
  });
  if (tasks.length !== orderedIds.length) throw new AppError(400, 'Tarefas fora da lista.');
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.task.update({ where: { id }, data: { sortOrder: index, syncState: 'PENDING' } })
    )
  );
}
