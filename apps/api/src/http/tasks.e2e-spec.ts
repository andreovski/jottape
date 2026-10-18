import type { CompleteTaskResponse, TaskListResponse, TaskResponse } from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

const NOW = new Date('2026-10-18T15:00:00Z');

describe('tarefas', () => {
  let api: ReturnType<typeof client>;

  beforeAll(() => app.ready());
  afterAll(() => app.close());
  afterEach(() => vi.useRealTimers());

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    await resetDatabase();
    api = client(app, (await loginAsOwner(app)).cookie);
  });

  const view = async (name: string) =>
    ((await api.get(`/tasks?view=${name}`)).json() as TaskResponse[]).map((t) => t.title);

  it('cria na caixa de entrada, com etiquetas, e filtra pelas visões', async () => {
    const [inbox] = (await api.get('/task-lists')).json() as TaskListResponse[];
    expect(inbox).toMatchObject({ isInbox: true, name: 'Entrada' });

    const created = (
      await api.post('/tasks', {
        title: 'Comprar pão',
        dueAt: '2026-10-18T03:00:00.000Z',
        tags: ['Casa', 'casa', 'mercado'],
      })
    ).json();
    expect(created).toMatchObject({ listId: inbox.id, tags: ['casa', 'mercado'], hasTime: false });

    await api.post('/tasks', { title: 'Atrasada', dueAt: '2026-10-15T03:00:00.000Z' });
    await api.post('/tasks', { title: 'Semana', dueAt: '2026-10-22T03:00:00.000Z' });
    await api.post('/tasks', { title: 'Algum dia' });

    expect((await view('today')).sort()).toEqual(['Atrasada', 'Comprar pão']);
    expect(await view('overdue')).toEqual(['Atrasada']);
    expect(await view('next7')).toEqual(['Comprar pão', 'Semana']);
    expect(await view('nodate')).toEqual(['Algum dia']);

    const tags = (await api.get('/tags')).json();
    expect(tags.map((t: { name: string; taskCount: number }) => [t.name, t.taskCount])).toEqual([
      ['casa', 1],
      ['mercado', 1],
    ]);
    expect(
      ((await api.get('/tasks?tag=mercado')).json() as TaskResponse[]).map((t) => t.title)
    ).toEqual(['Comprar pão']);
    expect(((await api.get('/task-lists')).json() as TaskListResponse[])[0].openCount).toBe(4);
  });

  it('subtarefas vêm dentro da mãe e vão até um nível', async () => {
    const parent = (await api.post('/tasks', { title: 'Viagem' })).json();
    const child = (
      await api.post('/tasks', { title: 'Passaporte', parentTaskId: parent.id })
    ).json();
    expect((await api.post('/tasks', { title: 'Neto', parentTaskId: child.id })).statusCode).toBe(
      400
    );

    const [listed] = (await api.get('/tasks')).json() as TaskResponse[];
    expect(listed.subtasks.map((s) => s.title)).toEqual(['Passaporte']);
  });

  it('concluir recorrente cria a próxima com etiquetas, lembretes e subtarefas', async () => {
    const tx = await prisma.transaction.findFirst();
    expect(tx).toBeNull();

    const task = (
      await api.post('/tasks', {
        title: 'Regar plantas',
        dueAt: '2026-10-18T03:00:00.000Z',
        rrule: 'FREQ=WEEKLY',
        tags: ['casa'],
        reminders: [0],
      })
    ).json();
    await api.post('/tasks', { title: 'Varanda', parentTaskId: task.id });

    const result: CompleteTaskResponse = (await api.post(`/tasks/${task.id}/complete`)).json();
    expect(result.task.completedAt).not.toBeNull();
    expect(result.next).toMatchObject({
      title: 'Regar plantas',
      dueAt: '2026-10-25T03:00:00.000Z',
      tags: ['casa'],
      reminders: [0],
    });
    expect(result.next!.subtasks.map((s) => s.title)).toEqual(['Varanda']);

    // Reminder da próxima: 9h do dia (prazo só com dia).
    const reminder = await prisma.reminder.findFirstOrThrow({
      where: { ownerId: result.next!.id },
    });
    expect(reminder.nextFireAt?.toISOString()).toBe('2026-10-25T12:00:00.000Z');
    // O da concluída não dispara mais.
    const old = await prisma.reminder.findFirstOrThrow({ where: { ownerId: task.id } });
    expect(old.nextFireAt).toBeNull();

    expect(await view('completed')).toEqual(['Regar plantas']);
  });

  it('tarefa ligada a conta prevista oferece marcar como paga', async () => {
    const account = (await api.post('/accounts', { name: 'Conta', type: 'CHECKING' })).json();
    const [bill] = (
      await api.post('/transactions', {
        kind: 'EXPENSE',
        amountCents: 90_00,
        date: '2026-10-25',
        accountId: account.id,
        description: 'Internet',
      })
    ).json();
    const task = (
      await api.post('/tasks', { title: 'Pagar internet', transactionId: bill.id })
    ).json();
    const result: CompleteTaskResponse = (await api.post(`/tasks/${task.id}/complete`)).json();
    expect(result.linkedPlannedTransactionId).toBe(bill.id);
  });

  it('reordena, move de lista, desfaz conclusão e apaga', async () => {
    const list: TaskListResponse = (await api.post('/task-lists', { name: 'Trabalho' })).json();
    const a = (await api.post('/tasks', { title: 'A', listId: list.id })).json();
    const b = (await api.post('/tasks', { title: 'B', listId: list.id })).json();
    await api.post('/tasks/reorder', { listId: list.id, orderedIds: [b.id, a.id] });
    expect(
      ((await api.get(`/tasks?listId=${list.id}`)).json() as TaskResponse[]).map((t) => t.title)
    ).toEqual(['B', 'A']);

    const moved = (
      await api.patch(`/tasks/${a.id}`, { listId: (await api.get('/task-lists')).json()[0].id })
    ).json();
    expect(moved.listId).not.toBe(list.id);

    await api.patch(`/tasks/${b.id}`, { completed: true });
    expect((await api.patch(`/tasks/${b.id}`, { completed: false })).json().completedAt).toBeNull();

    expect((await api.delete(`/tasks/${b.id}`)).statusCode).toBe(204);
    expect((await api.get(`/tasks/${b.id}`)).statusCode).toBe(404);

    const [inbox] = (await api.get('/task-lists')).json();
    expect((await api.delete(`/task-lists/${inbox.id}`)).statusCode).toBe(400);
    expect((await api.delete(`/task-lists/${list.id}`)).statusCode).toBe(204);
  });
});
