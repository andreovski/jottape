import {
  createTaskBodySchema,
  createTaskListBodySchema,
  listTasksQuerySchema,
  reorderTasksBodySchema,
  type TagResponse,
  updateTaskBodySchema,
  updateTaskListBodySchema,
} from '@jottape/schemas';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppError, notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { googleFetch, isConnected } from '@/services/google/client';
import { deleteTaskFromGoogle } from '@/services/google/tasks';
import { deleteReminders } from '@/services/reminders';
import { toTaskList } from '@/services/serializers';
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  inboxId,
  listTasks,
  reorderTasks,
  updateTask,
} from '@/services/tasks';

import { authenticate } from '../session';

const idParams = z.object({ id: z.string().uuid() });

export async function taskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ------------------------------------------------------------ listas

  app.get('/task-lists', async (request) => {
    await inboxId(request.userId);
    const [lists, counts] = await Promise.all([
      prisma.taskList.findMany({
        where: { userId: request.userId },
        orderBy: [{ isInbox: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.task.groupBy({
        by: ['listId'],
        where: { userId: request.userId, completedAt: null, deletedAt: null, parentTaskId: null },
        _count: true,
      }),
    ]);
    const countOf = new Map(counts.map((c) => [c.listId, c._count]));
    return lists.map((list) => toTaskList(list, countOf.get(list.id) ?? 0));
  });

  app.post('/task-lists', async (request, reply) => {
    const body = createTaskListBodySchema.parse(request.body);
    const last = await prisma.taskList.findFirst({
      where: { userId: request.userId },
      orderBy: { sortOrder: 'desc' },
    });
    const list = await prisma.taskList.create({
      data: {
        userId: request.userId,
        name: body.name,
        color: body.color ?? null,
        icon: body.icon ?? null,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        syncState: 'PENDING',
      },
    });
    return reply.status(201).send(toTaskList(list, 0));
  });

  app.patch('/task-lists/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateTaskListBodySchema.parse(request.body);
    const list = await prisma.taskList.findFirst({ where: { id, userId: request.userId } });
    if (!list) throw notFound('Lista');
    const updated = await prisma.taskList.update({
      where: { id },
      data: { ...body, ...(body.name && body.name !== list.name ? { syncState: 'PENDING' } : {}) },
    });
    const open = await prisma.task.count({
      where: { listId: id, completedAt: null, deletedAt: null, parentTaskId: null },
    });
    return toTaskList(updated, open);
  });

  app.delete('/task-lists/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const list = await prisma.taskList.findFirst({ where: { id, userId: request.userId } });
    if (!list) throw notFound('Lista');
    if (list.isInbox) throw new AppError(400, 'A caixa de entrada não pode ser apagada.');

    const tasks = await prisma.task.findMany({ where: { listId: id } });
    await deleteReminders(
      'TASK',
      tasks.map((t) => t.id)
    );
    // A lista some no Google também (e as tarefas com ela).
    if (list.googleTaskListId) {
      if (await isConnected(request.userId)) {
        await googleFetch(
          request.userId,
          `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(list.googleTaskListId)}`,
          { method: 'DELETE' }
        ).catch(() => undefined);
      }
    }
    await prisma.taskList.delete({ where: { id } });
    return reply.status(204).send();
  });

  // ------------------------------------------------------------ tarefas

  app.get('/tasks', async (request) => {
    return listTasks(request.userId, listTasksQuerySchema.parse(request.query));
  });

  app.get('/tasks/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return getTask(request.userId, id);
  });

  app.post('/tasks', async (request, reply) => {
    const body = createTaskBodySchema.parse(request.body);
    return reply.status(201).send(await createTask(request.userId, body));
  });

  app.patch('/tasks/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return updateTask(request.userId, id, updateTaskBodySchema.parse(request.body));
  });

  app.post('/tasks/:id/complete', async (request) => {
    const { id } = idParams.parse(request.params);
    return completeTask(request.userId, id);
  });

  app.delete('/tasks/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await deleteTask(request.userId, id);
    return reply.status(204).send();
  });

  app.post('/tasks/reorder', async (request, reply) => {
    const { listId, orderedIds } = reorderTasksBodySchema.parse(request.body);
    await reorderTasks(request.userId, listId, orderedIds);
    return reply.status(204).send();
  });

  /** Apaga as concluídas de uma lista (ou de todas). */
  app.delete('/tasks/completed', async (request, reply) => {
    const { listId } = z.object({ listId: z.string().uuid().optional() }).parse(request.query);
    const tasks = await prisma.task.findMany({
      where: {
        userId: request.userId,
        completedAt: { not: null },
        deletedAt: null,
        ...(listId ? { listId } : {}),
      },
    });
    await deleteReminders(
      'TASK',
      tasks.map((t) => t.id)
    );
    for (const task of tasks) {
      if (task.googleTaskId) {
        await prisma.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
        await deleteTaskFromGoogle({ ...task, deletedAt: new Date() });
      } else {
        await prisma.task.deleteMany({ where: { id: task.id } });
      }
    }
    return reply.status(204).send();
  });

  // ------------------------------------------------------------ etiquetas

  app.get('/tags', async (request): Promise<TagResponse[]> => {
    const tags = await prisma.tag.findMany({
      where: { userId: request.userId },
      include: {
        _count: { select: { tasks: { where: { task: { completedAt: null, deletedAt: null } } } } },
      },
      orderBy: { name: 'asc' },
    });
    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      taskCount: tag._count.tasks,
    }));
  });

  app.delete('/tags/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { count } = await prisma.tag.deleteMany({ where: { id, userId: request.userId } });
    if (count === 0) throw notFound('Etiqueta');
    return reply.status(204).send();
  });
}
