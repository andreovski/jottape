import type {
  CompleteTaskResponse,
  CreateTaskBody,
  CreateTaskListBody,
  ListTasksQuery,
  TagResponse,
  TaskListResponse,
  TaskResponse,
  UpdateTaskBody,
  UpdateTaskListBody,
} from '@jottape/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

function useInvalidateTasks() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ['tasks', 'task-lists', 'tags', 'agenda'].map((key) =>
        client.invalidateQueries({ queryKey: [key] })
      )
    );
}

export function useTaskLists() {
  return useQuery({
    queryKey: ['task-lists'],
    queryFn: () => api.get('task-lists').json<TaskListResponse[]>(),
  });
}

export function useCreateTaskList() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (body: CreateTaskListBody) =>
      api.post('task-lists', { json: body }).json<TaskListResponse>(),
    onSuccess: invalidate,
  });
}

export function useUpdateTaskList() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateTaskListBody & { id: string }) =>
      api.patch(`task-lists/${id}`, { json: body }).json<TaskListResponse>(),
    onSuccess: invalidate,
  });
}

export function useDeleteTaskList() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (id: string) => api.delete(`task-lists/${id}`),
    onSuccess: invalidate,
  });
}

export function useTasks(query: ListTasksQuery) {
  return useQuery({
    queryKey: ['tasks', query],
    queryFn: () =>
      api
        .get('tasks', {
          searchParams: Object.fromEntries(
            Object.entries(query).filter(([, value]) => value !== undefined && value !== '')
          ) as Record<string, string>,
        })
        .json<TaskResponse[]>(),
  });
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: () => api.get('tags').json<TagResponse[]>() });
}

export function useCreateTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (body: CreateTaskBody) => api.post('tasks', { json: body }).json<TaskResponse>(),
    onSuccess: invalidate,
  });
}

export function useUpdateTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateTaskBody & { id: string }) =>
      api.patch(`tasks/${id}`, { json: body }).json<TaskResponse>(),
    onSuccess: invalidate,
  });
}

export function useCompleteTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (id: string) => api.post(`tasks/${id}/complete`).json<CompleteTaskResponse>(),
    onSuccess: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (id: string) => api.delete(`tasks/${id}`),
    onSuccess: invalidate,
  });
}

export function useReorderTasks() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (body: { listId: string; orderedIds: string[] }) =>
      api.post('tasks/reorder', { json: body }),
    onSuccess: invalidate,
  });
}

export function useClearCompleted() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (listId?: string) =>
      api.delete('tasks/completed', { searchParams: listId ? { listId } : {} }),
    onSuccess: invalidate,
  });
}
