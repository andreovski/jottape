import { startOfDayInZone } from '@jottape/finance-engine';
import type { Task } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { GoogleApiError, googleFetch, recordError, tasksConnection } from './client';

// Google Tasks não tem webhook: o job puxa a cada 5 minutos, e cada mudança local é enviada na hora.
// O Google guarda só o dia do prazo (sem hora) e não tem recorrência nem lembrete: isso fica no
// Jottape.

const API = 'https://tasks.googleapis.com/tasks/v1';

interface GoogleTaskList {
  id: string;
  title: string;
}

export interface GoogleTask {
  id: string;
  etag?: string;
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string;
  completed?: string;
  deleted?: boolean;
  hidden?: boolean;
  parent?: string;
  updated?: string;
}

const enc = (value: string) => encodeURIComponent(value);

function localDate(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(instant);
}

function isNotFound(error: unknown) {
  return error instanceof GoogleApiError && (error.status === 404 || error.status === 410);
}

// ---------------------------------------------------------------- Jottape -> Google

async function googleBody(task: Task, timeZone: string) {
  return {
    title: task.title,
    notes: task.notes ?? '',
    due: task.dueAt ? `${localDate(task.dueAt, timeZone)}T00:00:00.000Z` : null,
    status: task.completedAt ? 'completed' : 'needsAction',
    ...(task.completedAt ? { completed: task.completedAt.toISOString() } : { completed: null }),
  };
}

export async function deleteTaskFromGoogle(
  task: Task,
  options: { keepLocal?: boolean } = {}
): Promise<void> {
  const list = await prisma.taskList.findUnique({ where: { id: task.listId } });
  const finish = async () => {
    if (!options.keepLocal) await prisma.task.deleteMany({ where: { id: task.id } });
  };
  const connection = await tasksConnection(task.userId);
  if (!task.googleTaskId || !list?.googleTaskListId || !connection) return finish();
  try {
    await googleFetch(
      connection.id,
      `${API}/lists/${enc(list.googleTaskListId)}/tasks/${enc(task.googleTaskId)}`,
      { method: 'DELETE' }
    );
    await finish();
  } catch (error) {
    if (isNotFound(error)) return finish();
    await recordError(connection.id, error);
  }
}

/** Envia a tarefa. Sem conexão ou com a lista ainda sem par no Google, fica PENDING para o sync. */
export async function pushTaskToGoogle(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { list: true, parent: true, user: { select: { timezone: true } } },
  });
  if (!task || !task.list.googleTaskListId) return;
  const connection = await tasksConnection(task.userId);
  if (!connection) return;
  if (task.deletedAt) return deleteTaskFromGoogle(task);

  const listUrl = `${API}/lists/${enc(task.list.googleTaskListId)}/tasks`;
  try {
    let result: GoogleTask;
    const body = await googleBody(task, task.user.timezone);
    if (task.googleTaskId) {
      result = await googleFetch<GoogleTask>(
        connection.id,
        `${listUrl}/${enc(task.googleTaskId)}`,
        {
          method: 'PATCH',
          body,
        }
      );
    } else {
      let parentGoogleId: string | undefined;
      if (task.parent) {
        if (!task.parent.googleTaskId) await pushTaskToGoogle(task.parent.id);
        const parent = await prisma.task.findUnique({ where: { id: task.parent.id } });
        parentGoogleId = parent?.googleTaskId ?? undefined;
      }
      result = await googleFetch<GoogleTask>(connection.id, listUrl, {
        method: 'POST',
        body,
        query: { parent: parentGoogleId },
      });
    }
    await prisma.task.update({
      where: { id: task.id },
      data: { googleTaskId: result.id, googleEtag: result.etag ?? null, syncState: 'SYNCED' },
    });
  } catch (error) {
    if (isNotFound(error) && task.googleTaskId) {
      // Apagada no Google: some aqui também.
      await prisma.task.delete({ where: { id: task.id } });
      return;
    }
    await prisma.task.update({ where: { id: task.id }, data: { syncState: 'ERROR' } });
    await recordError(connection.id, error);
  }
}

// ---------------------------------------------------------------- Google -> Jottape

async function syncLists(userId: string, connectionId: string) {
  const [lists, defaultList] = await Promise.all([
    googleFetch<{ items?: GoogleTaskList[] }>(connectionId, `${API}/users/@me/lists`, {
      query: { maxResults: '100' },
    }),
    googleFetch<GoogleTaskList>(connectionId, `${API}/users/@me/lists/@default`),
  ]);
  const remote = lists.items ?? [];
  const seen = new Set(remote.map((l) => l.id));

  // A lista padrão do Google ("Minhas tarefas") é a caixa de entrada do Jottape.
  const inbox = await prisma.taskList.findFirst({ where: { userId, isInbox: true } });
  if (inbox && inbox.googleTaskListId !== defaultList.id) {
    await prisma.taskList.update({
      where: { id: inbox.id },
      data: { googleTaskListId: defaultList.id },
    });
  }

  for (const list of remote) {
    if (list.id === defaultList.id) continue;
    const existing = await prisma.taskList.findFirst({
      where: { userId, googleTaskListId: list.id },
    });
    if (existing) {
      if (existing.name !== list.title && existing.syncState !== 'PENDING') {
        await prisma.taskList.update({ where: { id: existing.id }, data: { name: list.title } });
      }
    } else {
      await prisma.taskList.create({
        data: { userId, name: list.title, googleTaskListId: list.id },
      });
    }
  }

  // Lista apagada no Google: a do Jottape fica, só sem o vínculo (nada se perde).
  const orphaned = await prisma.taskList.findMany({
    where: { userId, isInbox: false, googleTaskListId: { not: null } },
  });
  for (const list of orphaned.filter((l) => !seen.has(l.googleTaskListId!))) {
    await prisma.task.updateMany({
      where: { listId: list.id },
      data: { googleTaskId: null, googleEtag: null, syncState: 'PENDING' },
    });
    await prisma.taskList.update({ where: { id: list.id }, data: { googleTaskListId: null } });
  }

  // Lista criada no Jottape: cria no Google.
  const local = await prisma.taskList.findMany({
    where: { userId, isInbox: false, OR: [{ googleTaskListId: null }, { syncState: 'PENDING' }] },
  });
  for (const list of local) {
    const result = list.googleTaskListId
      ? await googleFetch<GoogleTaskList>(
          connectionId,
          `${API}/users/@me/lists/${enc(list.googleTaskListId)}`,
          {
            method: 'PATCH',
            body: { title: list.name },
          }
        )
      : await googleFetch<GoogleTaskList>(connectionId, `${API}/users/@me/lists`, {
          method: 'POST',
          body: { title: list.name },
        });
    await prisma.taskList.update({
      where: { id: list.id },
      data: { googleTaskListId: result.id, syncState: 'SYNCED' },
    });
  }
}

async function pullList(
  userId: string,
  connectionId: string,
  listId: string,
  googleListId: string,
  timeZone: string,
  updatedMin: Date | null
) {
  const items: GoogleTask[] = [];
  let pageToken: string | undefined;
  do {
    const page = await googleFetch<{ items?: GoogleTask[]; nextPageToken?: string }>(
      connectionId,
      `${API}/lists/${enc(googleListId)}/tasks`,
      {
        query: {
          maxResults: '100',
          showCompleted: 'true',
          showHidden: 'true',
          showDeleted: 'true',
          pageToken,
          updatedMin: updatedMin?.toISOString(),
        },
      }
    );
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  const parentsToLink: { localId: string; parentGoogleId: string }[] = [];
  let nextOrder =
    ((await prisma.task.findFirst({ where: { listId }, orderBy: { sortOrder: 'desc' } }))
      ?.sortOrder ?? -1) + 1;

  for (const item of items) {
    const existing = await prisma.task.findFirst({ where: { listId, googleTaskId: item.id } });
    if (existing?.syncState === 'PENDING' || existing?.deletedAt) continue;

    if (item.deleted) {
      if (existing) await prisma.task.delete({ where: { id: existing.id } });
      continue;
    }

    let dueAt: Date | null = null;
    let hasTime = false;
    if (item.due) {
      const day = item.due.slice(0, 10);
      // Prazo com hora feito no Jottape: o Google só tem o dia; mantém a hora se o dia não mudou.
      if (existing?.dueAt && existing.hasTime && localDate(existing.dueAt, timeZone) === day) {
        dueAt = existing.dueAt;
        hasTime = true;
      } else {
        dueAt = startOfDayInZone(day, timeZone);
      }
    }

    const data = {
      title: item.title?.trim() || '(sem título)',
      notes: item.notes ?? null,
      dueAt,
      hasTime,
      completedAt:
        item.status === 'completed'
          ? (existing?.completedAt ?? (item.completed ? new Date(item.completed) : new Date()))
          : null,
      googleEtag: item.etag ?? null,
      syncState: 'SYNCED' as const,
    };

    const saved = existing
      ? await prisma.task.update({ where: { id: existing.id }, data })
      : await prisma.task.create({
          data: { ...data, userId, listId, googleTaskId: item.id, sortOrder: nextOrder++ },
        });
    if (item.parent) parentsToLink.push({ localId: saved.id, parentGoogleId: item.parent });
    else if (saved.parentTaskId) {
      await prisma.task.update({ where: { id: saved.id }, data: { parentTaskId: null } });
    }
  }

  for (const { localId, parentGoogleId } of parentsToLink) {
    const parent = await prisma.task.findFirst({ where: { listId, googleTaskId: parentGoogleId } });
    if (parent)
      await prisma.task.update({ where: { id: localId }, data: { parentTaskId: parent.id } });
  }
}

export async function syncTasks(userId: string) {
  const connection = await tasksConnection(userId);
  if (!connection) return;
  const startedAt = new Date();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await syncLists(userId, connection.id);

    const lists = await prisma.taskList.findMany({
      where: { userId, googleTaskListId: { not: null } },
    });
    const since = connection.tasksSyncedAt
      ? new Date(connection.tasksSyncedAt.getTime() - 60_000)
      : null;
    for (const list of lists) {
      await pullList(userId, connection.id, list.id, list.googleTaskListId!, user.timezone, since);
    }

    const pending = await prisma.task.findMany({
      where: {
        userId,
        list: { googleTaskListId: { not: null } },
        OR: [{ syncState: { in: ['PENDING', 'ERROR'] } }, { deletedAt: { not: null } }],
      },
      orderBy: { parentTaskId: { sort: 'asc', nulls: 'first' } },
    });
    for (const task of pending) await pushTaskToGoogle(task.id);

    await prisma.googleConnection.update({
      where: { id: connection.id },
      data: { tasksSyncedAt: startedAt },
    });
  } catch (error) {
    await recordError(connection.id, error);
  }
}

/** Tira o vínculo das tarefas com o Google Tasks (nada se perde; sobem de novo na próxima conta). */
export function unlinkTasksOps(userId: string) {
  return [
    prisma.task.deleteMany({ where: { userId, deletedAt: { not: null } } }),
    prisma.task.updateMany({
      where: { userId },
      data: { googleTaskId: null, googleEtag: null, syncState: 'PENDING' },
    }),
    prisma.taskList.updateMany({
      where: { userId },
      data: { googleTaskListId: null, syncState: 'PENDING' },
    }),
  ];
}
