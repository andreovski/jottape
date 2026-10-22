import type { TaskListResponse, TaskResponse } from '@jottape/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appTimeZone, setAppTimeZone } from '@/lib/format';

import {
  addTag,
  applyOrder,
  bodyFromForm,
  canQuickAdd,
  dueInfo,
  findTask,
  formFromTask,
  groupBySchedule,
  groupTasks,
  listColor,
  moveId,
  normalizeTag,
  priorityMark,
  queryForTarget,
  quickAddBody,
  reminderLabel,
  reminderOptions,
  repeatValue,
  resolveListParam,
  SMART_VIEWS,
  smartView,
  sortLists,
  visibleSubtasks,
} from './task-logic';

const TZ = 'America/Sao_Paulo';

function task(overrides: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id: 't1',
    listId: 'l1',
    parentTaskId: null,
    title: 'Comprar pão',
    notes: null,
    dueAt: null,
    hasTime: false,
    priority: null,
    rrule: null,
    completedAt: null,
    sortOrder: 0,
    transactionId: null,
    tags: [],
    reminders: [],
    googleLinked: false,
    subtasks: [],
    ...overrides,
  };
}

function list(overrides: Partial<TaskListResponse> = {}): TaskListResponse {
  return {
    id: 'l1',
    name: 'Mercado',
    color: null,
    icon: null,
    sortOrder: 0,
    isInbox: false,
    googleLinked: false,
    openCount: 0,
    ...overrides,
  };
}

let previousZone: string;
beforeEach(() => {
  previousZone = appTimeZone();
  setAppTimeZone(TZ);
});
afterEach(() => setAppTimeZone(previousZone));

// 18/10/2026, 15:00 em São Paulo (UTC−3).
const NOW = new Date('2026-10-18T18:00:00Z');

describe('listas inteligentes', () => {
  it('mapeia cada nome da URL para a visão da API', () => {
    expect(SMART_VIEWS.map((v) => [v.slug, v.view])).toEqual([
      ['hoje', 'today'],
      ['programadas', 'next7'],
      ['atrasadas', 'overdue'],
      ['sem-prazo', 'nodate'],
      ['todas', undefined],
      ['concluidas', 'completed'],
    ]);
    expect(smartView('hoje')?.title).toBe('Hoje');
    expect(smartView('outra')).toBeUndefined();
  });

  it('distingue lista de visão e monta a consulta', () => {
    const smart = resolveListParam('todas', 'casa');
    expect(smart.kind).toBe('smart');
    expect(queryForTarget(smart)).toEqual({ view: undefined, tag: 'casa' });
    const real = resolveListParam('3f1c-uuid');
    expect(real).toEqual({ kind: 'list', id: '3f1c-uuid' });
    expect(queryForTarget(real)).toEqual({ listId: '3f1c-uuid' });
    expect(resolveListParam('hoje', '')).toMatchObject({ tag: undefined });
  });

  it('não oferece adição rápida onde o lembrete sumiria', () => {
    expect(canQuickAdd(resolveListParam('atrasadas'))).toBe(false);
    expect(canQuickAdd(resolveListParam('concluidas'))).toBe(false);
    expect(canQuickAdd(resolveListParam('hoje'))).toBe(true);
    expect(canQuickAdd(resolveListParam('abc'))).toBe(true);
  });
});

describe('listas', () => {
  it('põe a Entrada primeiro e respeita a ordem', () => {
    const sorted = sortLists([
      list({ id: 'b', sortOrder: 2 }),
      list({ id: 'a', sortOrder: 1 }),
      list({ id: 'inbox', isInbox: true, sortOrder: 9 }),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(['inbox', 'a', 'b']);
  });

  it('usa a cor da lista ou a padrão', () => {
    expect(listColor(list({ color: '#ff2d55' }))).toBe('#ff2d55');
    expect(listColor(list({ isInbox: true }))).toBe('var(--blue)');
    expect(listColor(list())).toBe('var(--orange)');
  });
});

describe('prazo', () => {
  it('sem prazo não tem rótulo', () => {
    expect(dueInfo(task(), NOW)).toBeNull();
  });

  it('dia sem hora: hoje não está atrasado, ontem está', () => {
    const today = dueInfo(task({ dueAt: '2026-10-18T03:00:00Z' }), NOW);
    expect(today).toEqual({ label: 'Hoje', overdue: false, key: '2026-10-18' });
    const yesterday = dueInfo(task({ dueAt: '2026-10-17T03:00:00Z' }), NOW);
    expect(yesterday).toMatchObject({ label: 'Ontem', overdue: true });
  });

  it('com hora: atrasa quando o horário passa e mostra a hora', () => {
    const past = dueInfo(task({ dueAt: '2026-10-18T12:00:00Z', hasTime: true }), NOW);
    expect(past).toEqual({ label: 'Hoje, 09:00', overdue: true, key: '2026-10-18' });
    const later = dueInfo(task({ dueAt: '2026-10-19T20:30:00Z', hasTime: true }), NOW);
    expect(later).toMatchObject({ label: 'Amanhã, 17:30', overdue: false });
  });

  it('concluída nunca fica vermelha', () => {
    const done = dueInfo(
      task({ dueAt: '2026-10-10T03:00:00Z', completedAt: '2026-10-11T00:00:00Z' }),
      NOW
    );
    expect(done?.overdue).toBe(false);
  });
});

describe('prioridade', () => {
  it('usa as exclamações do Lembretes', () => {
    expect(priorityMark(null)).toBe('');
    expect(priorityMark('LOW')).toBe('!');
    expect(priorityMark('MEDIUM')).toBe('!!');
    expect(priorityMark('HIGH')).toBe('!!!');
  });
});

describe('ordem', () => {
  it('move um id para a posição de outro', () => {
    expect(moveId(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveId(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveId(['a', 'b'], 'a', 'x')).toEqual(['a', 'b']);
  });

  it('aplica a ordem local e mantém os que não estavam nela', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(applyOrder(items, null)).toBe(items);
    expect(applyOrder(items, ['c', 'a']).map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(applyOrder(items, ['z', 'b']).map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('mostra só subtarefas abertas, salvo na visão de concluídas', () => {
    const parent = task({
      subtasks: [task({ id: 's1' }), task({ id: 's2', completedAt: '2026-10-01T00:00:00Z' })],
    });
    expect(visibleSubtasks(parent, false).map((s) => s.id)).toEqual(['s1']);
    expect(visibleSubtasks(parent, true)).toHaveLength(2);
  });

  it('agrupa por dia em ordem cronológica', () => {
    const groups = groupTasks(
      [
        task({ id: 'b', dueAt: '2026-10-19T03:00:00Z' }),
        task({ id: 'a', dueAt: '2026-10-18T15:00:00Z', hasTime: true }),
        task({ id: 'c', dueAt: '2026-10-19T20:00:00Z', hasTime: true }),
      ],
      'day',
      { today: '2026-10-18', timeZone: TZ }
    );
    expect(groups.map((g) => [g.title, g.tasks.map((t) => t.id)])).toEqual([
      ['Hoje', ['a']],
      ['Amanhã', ['b', 'c']],
    ]);
  });

  it('agrupa por lista na ordem das listas, sem grupos vazios', () => {
    const lists = [
      list({ id: 'x', name: 'Casa', sortOrder: 1, color: '#34c759' }),
      list({ id: 'in', name: 'Entrada', isInbox: true }),
      list({ id: 'y', name: 'Vazia', sortOrder: 2 }),
    ];
    const groups = groupTasks(
      [task({ id: '1', listId: 'x' }), task({ id: '2', listId: 'in' })],
      'list',
      { lists, today: '2026-10-18' }
    );
    expect(groups.map((g) => [g.title, g.color])).toEqual([
      ['Entrada', 'var(--blue)'],
      ['Casa', '#34c759'],
    ]);
  });

  it('divide "Todas" como a tela Hoje: hoje (atrasadas na frente), em breve e sem data', () => {
    const groups = groupBySchedule(
      [
        task({ id: 'semana', dueAt: '2026-10-21T03:00:00Z' }),
        task({ id: 'sem-a' }),
        task({ id: 'hoje', dueAt: '2026-10-18T15:00:00Z', hasTime: true }),
        task({ id: 'sem-b', priority: 'HIGH' }),
        task({ id: 'ontem', dueAt: '2026-10-17T03:00:00Z' }),
        task({ id: 'amanha', dueAt: '2026-10-19T03:00:00Z' }),
      ],
      { today: '2026-10-18', timeZone: TZ }
    );
    expect(groups.map((g) => [g.title, g.tasks.map((t) => t.id)])).toEqual([
      ['Hoje', ['ontem', 'hoje']],
      ['Em breve', ['amanha', 'semana']],
      ['Sem data', ['sem-b', 'sem-a']],
    ]);
  });

  it('mantém Hoje mesmo vazio e tira os outros grupos vazios', () => {
    const groups = groupBySchedule([task({ id: 'x' })], { today: '2026-10-18', timeZone: TZ });
    expect(groups.map((g) => [g.id, g.tasks.length])).toEqual([
      ['hoje', 0],
      ['sem-data', 1],
    ]);
  });

  it('acha tarefas e subtarefas pelo id', () => {
    const data = [task({ id: 'p', subtasks: [task({ id: 's', parentTaskId: 'p' })] })];
    expect(findTask([undefined, data], 's')?.parentTaskId).toBe('p');
    expect(findTask([data], 'p')?.id).toBe('p');
    expect(findTask([data], null)).toBeNull();
  });
});

describe('etiquetas', () => {
  it('normaliza e não repete', () => {
    expect(normalizeTag('  #casa nova ')).toBe('casa-nova');
    expect(addTag(['Casa'], 'casa')).toEqual(['Casa']);
    expect(addTag([], '#mercado')).toEqual(['mercado']);
    expect(addTag([], '  ')).toEqual([]);
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
    expect(addTag(ten, 'mais')).toBe(ten);
  });
});

describe('formulário', () => {
  it('lembretes: rótulos e valores de fora', () => {
    expect(reminderLabel(0)).toBe('Na hora');
    expect(reminderLabel(120)).toBe('2 h antes');
    expect(reminderLabel(2880)).toBe('2 dias antes');
    expect(reminderLabel(15)).toBe('15 min antes');
    expect(reminderOptions('15').at(-1)).toEqual({ value: '15', label: '15 min antes' });
    expect(reminderOptions('30')).toHaveLength(6);
  });

  it('repetição simples vira a opção; complexa é preservada', () => {
    expect(repeatValue(null)).toBe('');
    expect(repeatValue('FREQ=WEEKLY')).toBe('WEEKLY');
    expect(repeatValue('FREQ=WEEKLY;BYDAY=MO,WE')).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
  });

  it('lê uma tarefa com hora', () => {
    const form = formFromTask(
      task({
        dueAt: '2026-10-20T13:30:00Z',
        hasTime: true,
        rrule: 'FREQ=DAILY',
        reminders: [10],
        tags: ['casa'],
        priority: 'HIGH',
      }),
      { listId: '', today: '2026-10-18' },
      TZ
    );
    expect(form).toMatchObject({
      hasDate: true,
      date: '2026-10-20',
      hasTime: true,
      time: '10:30',
      repeat: 'DAILY',
      reminder: '10',
      priority: 'HIGH',
      listId: 'l1',
    });
  });

  it('novo lembrete começa com os padrões', () => {
    const form = formFromTask(null, { listId: 'in', today: '2026-10-18', date: '2026-10-18' });
    expect(form).toMatchObject({ hasDate: true, date: '2026-10-18', hasTime: false, listId: 'in' });
  });

  it('dia sem hora vira meia-noite no fuso, sem hora', () => {
    const form = formFromTask(null, { listId: 'in', today: '2026-10-18' });
    const body = bodyFromForm(
      { ...form, title: '  Pagar luz ', hasDate: true, date: '2026-10-20', repeat: 'MONTHLY' },
      TZ
    );
    expect(body).toMatchObject({
      title: 'Pagar luz',
      notes: null,
      dueAt: '2026-10-20T03:00:00.000Z',
      hasTime: false,
      rrule: 'FREQ=MONTHLY',
      reminders: [],
      listId: 'in',
    });
  });

  it('com hora vira o instante no fuso, com lembrete', () => {
    const form = formFromTask(null, { listId: '', today: '2026-10-18' });
    const body = bodyFromForm(
      {
        ...form,
        title: 'Dentista',
        hasDate: true,
        date: '2026-10-20',
        hasTime: true,
        time: '14:15',
        reminder: '60',
      },
      TZ
    );
    expect(body).toMatchObject({
      dueAt: '2026-10-20T17:15:00.000Z',
      hasTime: true,
      reminders: [60],
      listId: undefined,
    });
  });

  it('sem data descarta repetição e lembrete', () => {
    const form = formFromTask(null, { listId: '', today: '2026-10-18' });
    const body = bodyFromForm({ ...form, title: 'x', repeat: 'DAILY', reminder: '0' }, TZ);
    expect(body).toMatchObject({ dueAt: null, hasTime: false, rrule: null, reminders: [] });
  });

  it('adição rápida: hoje ganha a data, lista real ganha a lista, etiqueta vai junto', () => {
    const options = { today: '2026-10-18', timeZone: TZ };
    expect(quickAddBody(' Leite ', resolveListParam('hoje'), options)).toEqual({
      title: 'Leite',
      dueAt: '2026-10-18T03:00:00.000Z',
      hasTime: false,
    });
    expect(quickAddBody('Leite', resolveListParam('l9'), options)).toEqual({
      title: 'Leite',
      listId: 'l9',
    });
    expect(quickAddBody('Leite', resolveListParam('todas', 'casa'), options)).toEqual({
      title: 'Leite',
      tags: ['casa'],
    });
    expect(quickAddBody('Leite', resolveListParam('sem-prazo'), options)).toEqual({
      title: 'Leite',
    });
  });
});
