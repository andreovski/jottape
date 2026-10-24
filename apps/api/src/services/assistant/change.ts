import type Anthropic from '@anthropic-ai/sdk';
import {
  addDays,
  instantToWallTime,
  parseDateString,
  wallTimeToInstant,
} from '@jottape/finance-engine';
import type {
  AssistantChangeDraft,
  UpdateEventBody,
  UpdateTaskBody,
  UpdateTransactionBody,
} from '@jottape/schemas';

import { fromDbDate } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { deleteEvent, listOccurrences, updateEvent } from '@/services/events';
import { deleteTransaction, updateTransaction } from '@/services/finance';
import { completeTask, deleteTask, updateTask } from '@/services/tasks';

import { type AnswerContext, conversation, runToolLoop, type ToolLoopResult } from './answer';
import { WEEKDAYS } from './haiku';
import { matchByName } from './resolve';

// Mudar, apagar ou concluir algo que já existe ("o uber de ontem foi 35", "apaga o dentista",
// "marca o IPVA como feito"). O Haiku acha o item pelas consultas e propõe a mudança; aqui ela é
// conferida contra o banco e vira um cartão que o usuário confirma. Nunca salva sozinho.

/** Mudanças por pedido: o resto é ignorado. */
const MAX_CHANGES = 3;

const nullableString = (description: string) => ({ type: ['string', 'null'], description });

const PROPOSE_TOOL: Anthropic.Tool = {
  name: 'propor_mudanca',
  description:
    'Propõe a mudança de um item que você achou com as consultas (use o id que veio delas). Chame uma vez por item; o usuário confirma antes de valer. Nos campos, só o que muda: o resto vai null.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'alvo',
      'id',
      'ocorrencia',
      'acao',
      'descricao',
      'valor_centavos',
      'data',
      'hora_inicio',
      'hora_fim',
      'categoria',
      'conta',
      'local',
      'sem_prazo',
    ],
    properties: {
      alvo: { type: 'string', enum: ['lancamento', 'evento', 'tarefa'] },
      id: { type: 'string', description: 'O id do item, como veio da consulta.' },
      ocorrencia: nullableString(
        'Evento que se repete: a "ocorrencia" que veio da agenda, para mexer só nela. Senão null.'
      ),
      acao: { type: 'string', enum: ['editar', 'apagar', 'concluir'] },
      descricao: nullableString('Nova descrição do lançamento ou novo título do evento ou tarefa.'),
      valor_centavos: { type: ['integer', 'null'], description: 'Novo valor do lançamento.' },
      data: nullableString('Nova data AAAA-MM-DD (do lançamento, do evento ou do prazo).'),
      hora_inicio: nullableString('Novo horário HH:MM (início do evento ou hora do prazo).'),
      hora_fim: nullableString('Novo fim HH:MM do evento.'),
      categoria: nullableString('Nome EXATO da nova categoria.'),
      conta: nullableString('Nome EXATO da nova conta.'),
      local: nullableString('Novo local do evento.'),
      sem_prazo: { type: 'boolean', description: 'true para tirar o prazo da tarefa.' },
    },
  },
};

function changePrompt(ctx: AnswerContext): string {
  const weekday = WEEKDAYS[new Date(`${ctx.today}T12:00:00Z`).getUTCDay()];
  return `Você é o Jotta, o assistente do Jottape, um app brasileiro de finanças, agenda e tarefas. O usuário quer mudar, apagar ou concluir algo que já existe. Ache o item com as consultas e chame propor_mudanca com o id dele.

Hoje é ${weekday}, ${ctx.today} (fuso ${ctx.timezone}).

Contas e cartões: ${ctx.accounts.map((a) => a.name).join(', ') || '(nenhuma)'}
Categorias: ${ctx.categories.map((c) => c.name).join(', ') || '(nenhuma)'}
Listas de tarefas: ${ctx.lists.map((l) => l.name).join(', ') || '(nenhuma)'}

Regras:
- "O último lançamento" é o lançado por último: consulte lançamentos com ordem "recentes" num período largo (os últimos 60 dias).
- Procure pelo período que o pedido diz ("o uber de ontem", "o dentista de sexta"); sem período, os últimos 30 dias para lançamentos e os próximos 30 para agenda e tarefas.
- Só proponha quando tiver certeza de qual é o item. Se houver mais de um que sirva e o pedido não decidir, ou nenhum, não proponha: responda em uma frase dizendo o que achou e pedindo para o usuário ser mais específico.
- "Marca como feita", "já paguei o IPVA" (tarefa) é concluir. "Tira", "cancela", "apaga" é apagar.
- Em editar, preencha só o que muda; mudar o horário de um evento sem dizer o fim mantém a duração (hora_fim null).
- Não crie nada novo: lançamentos, eventos e tarefas novos são feitos por outra parte do app.
- Responda em português do Brasil, em texto simples. Escreva valor em dinheiro como [[centavos]].`;
}

export interface ChangePlan extends Omit<ToolLoopResult, 'finals'> {
  drafts: AssistantChangeDraft[];
}

/** Acha o que o pedido quer mudar. Lança erro se o modelo falhar. */
export async function planChanges(text: string, ctx: AnswerContext): Promise<ChangePlan> {
  const { finals, ...result } = await runToolLoop(ctx, {
    system: changePrompt(ctx),
    messages: conversation(ctx, text),
    final: PROPOSE_TOOL,
  });
  const drafts: AssistantChangeDraft[] = [];
  for (const proposal of finals.slice(0, MAX_CHANGES)) {
    const draft = await buildChange(ctx, proposal).catch(() => null);
    if (draft) drafts.push(draft);
  }
  return { ...result, drafts };
}

// ---------------------------------------------------------------- conferir a proposta

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const isDate = (value: string | null): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const isTime = (value: string | null): value is string =>
  !!value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const pad = (n: number) => String(n).padStart(2, '0');
function wall(instant: Date, timeZone: string) {
  const w = instantToWallTime(instant, timeZone);
  return {
    date: `${w.year}-${pad(w.month)}-${pad(w.day)}`,
    time: `${pad(w.hour)}:${pad(w.minute)}`,
  };
}
const instant = (date: string, time: string, timeZone: string) =>
  wallTimeToInstant(
    { ...parseDateString(date), hour: Number(time.slice(0, 2)), minute: Number(time.slice(3)) },
    timeZone
  );

type Diff = AssistantChangeDraft['diffs'][number];
const ACTIONS = { editar: 'update', apagar: 'delete', concluir: 'complete' } as const;

/** A proposta do modelo conferida no banco (o item é do usuário, os nomes existem). Null se não serve. */
export async function buildChange(
  ctx: AnswerContext,
  proposal: Record<string, unknown>
): Promise<AssistantChangeDraft | null> {
  const id = str(proposal.id);
  const action = ACTIONS[proposal.acao as keyof typeof ACTIONS];
  if (!id || !action) return null;
  if (proposal.alvo === 'lancamento') return transactionChange(ctx, id, action, proposal);
  if (proposal.alvo === 'evento') return eventChange(ctx, id, action, proposal);
  if (proposal.alvo === 'tarefa') return taskChange(ctx, id, action, proposal);
  return null;
}

async function transactionChange(
  ctx: AnswerContext,
  id: string,
  action: AssistantChangeDraft['action'],
  p: Record<string, unknown>
): Promise<AssistantChangeDraft | null> {
  const tx = await prisma.transaction.findFirst({
    where: { id, userId: ctx.userId },
    include: { category: true, account: true },
  });
  if (!tx || action === 'complete') return null;
  const base = {
    type: 'change' as const,
    target: 'transaction' as const,
    targetId: tx.id,
    title: tx.description,
    date: fromDbDate(tx.date),
    amountCents: tx.amountCents,
  };
  if (action === 'delete') {
    return { ...base, action, diffs: [], apply: { scope: 'single' }, revert: null };
  }

  const apply: UpdateTransactionBody = { scope: 'single' };
  const revert: UpdateTransactionBody = { scope: 'single' };
  const diffs: Diff[] = [];
  const description = str(p.descricao);
  if (description && description !== tx.description) {
    apply.description = description.slice(0, 120);
    revert.description = tx.description;
    diffs.push({ field: 'description', before: tx.description, after: apply.description });
  }
  const amount = typeof p.valor_centavos === 'number' ? Math.round(p.valor_centavos) : null;
  if (amount && amount > 0 && amount !== tx.amountCents) {
    apply.amountCents = amount;
    revert.amountCents = tx.amountCents;
    diffs.push({ field: 'amount', before: tx.amountCents, after: amount });
  }
  const date = str(p.data);
  if (isDate(date) && date !== base.date) {
    apply.date = date;
    revert.date = base.date;
    diffs.push({ field: 'date', before: base.date, after: date });
  }
  if (tx.kind !== 'TRANSFER') {
    const categories = ctx.categories.filter((c) => c.kind === tx.kind);
    const category = matchByName(categories, str(p.categoria));
    if (category && category.id !== tx.categoryId) {
      apply.categoryId = category.id;
      revert.categoryId = tx.categoryId;
      diffs.push({ field: 'category', before: tx.category?.name ?? null, after: category.name });
    }
  }
  const account = matchByName(
    ctx.accounts.filter((a) => tx.kind === 'EXPENSE' || a.type !== 'CREDIT_CARD'),
    str(p.conta)
  );
  if (account && account.id !== tx.accountId) {
    apply.accountId = account.id;
    revert.accountId = tx.accountId;
    diffs.push({ field: 'account', before: tx.account.name, after: account.name });
  }
  if (diffs.length === 0) return null;
  return { ...base, action, diffs, apply, revert };
}

async function eventChange(
  ctx: AnswerContext,
  id: string,
  action: AssistantChangeDraft['action'],
  p: Record<string, unknown>
): Promise<AssistantChangeDraft | null> {
  const event = await prisma.event.findFirst({ where: { id, userId: ctx.userId } });
  if (!event || action === 'complete') return null;

  // A ocorrência como está na agenda (num evento que se repete, pode já ter sido mudada).
  const occurrenceStart = event.rrule ? str(p.ocorrencia) : null;
  if (event.rrule && !occurrenceStart) return null;
  const around = occurrenceStart ? new Date(occurrenceStart) : event.startAt;
  if (Number.isNaN(around.getTime())) return null;
  const occurrences = await listOccurrences(
    ctx.userId,
    new Date(around.getTime() - 2 * 86_400_000),
    new Date(around.getTime() + 2 * 86_400_000)
  );
  const current = occurrences.find(
    (o) =>
      o.eventId === event.id &&
      (!occurrenceStart || new Date(o.occurrenceStart).getTime() === around.getTime())
  );
  if (!current) return null;

  const scope = occurrenceStart
    ? { scope: 'single' as const, occurrenceStart: current.occurrenceStart }
    : { scope: 'all' as const };
  const start = new Date(current.startAt);
  const end = new Date(current.endAt);
  const zone = current.allDay ? 'UTC' : ctx.timezone;
  const startWall = wall(start, zone);
  const base = {
    type: 'change' as const,
    target: 'event' as const,
    targetId: event.id,
    title: current.title,
    date: startWall.date,
    amountCents: null,
  };
  if (action === 'delete') return { ...base, action, diffs: [], apply: scope, revert: null };

  const apply: UpdateEventBody = { ...scope };
  const revert: UpdateEventBody = { ...scope };
  const diffs: Diff[] = [];
  const title = str(p.descricao);
  if (title && title !== current.title) {
    apply.title = title.slice(0, 200);
    revert.title = current.title;
    diffs.push({ field: 'title', before: current.title, after: apply.title });
  }
  const location = str(p.local);
  if (location && location !== current.location) {
    apply.location = location.slice(0, 300);
    revert.location = current.location;
    diffs.push({ field: 'location', before: current.location, after: apply.location });
  }

  const date = str(p.data);
  const newDate = isDate(date) ? date : startWall.date;
  const startTime = str(p.hora_inicio);
  const endTime = str(p.hora_fim);
  let newStart = start;
  let newEnd = end;
  if (current.allDay) {
    if (newDate !== startWall.date) {
      const days = Math.round((Date.parse(newDate) - Date.parse(startWall.date)) / 86_400_000);
      newStart = new Date(`${newDate}T00:00:00.000Z`);
      newEnd = new Date(`${addDays(wall(end, 'UTC').date, days)}T00:00:00.000Z`);
    }
  } else {
    const endWall = wall(end, zone);
    newStart = instant(newDate, isTime(startTime) ? startTime : startWall.time, ctx.timezone);
    newEnd = isTime(endTime)
      ? instant(newDate, endTime, ctx.timezone)
      : new Date(newStart.getTime() + (end.getTime() - start.getTime()));
    if (newEnd <= newStart) return null;
    const after = wall(newStart, zone);
    if (after.date !== startWall.date) {
      diffs.push({ field: 'date', before: startWall.date, after: after.date });
    }
    if (after.time !== startWall.time) {
      diffs.push({ field: 'start', before: startWall.time, after: after.time });
    }
    const afterEnd = wall(newEnd, zone).time;
    if (afterEnd !== endWall.time)
      diffs.push({ field: 'end', before: endWall.time, after: afterEnd });
  }
  if (newStart.getTime() !== start.getTime() || newEnd.getTime() !== end.getTime()) {
    if (current.allDay) diffs.push({ field: 'date', before: startWall.date, after: newDate });
    apply.startAt = newStart.toISOString();
    apply.endAt = newEnd.toISOString();
    revert.startAt = start.toISOString();
    revert.endAt = end.toISOString();
  }
  if (diffs.length === 0) return null;
  return { ...base, action, diffs, apply, revert };
}

async function taskChange(
  ctx: AnswerContext,
  id: string,
  action: AssistantChangeDraft['action'],
  p: Record<string, unknown>
): Promise<AssistantChangeDraft | null> {
  const task = await prisma.task.findFirst({ where: { id, userId: ctx.userId, deletedAt: null } });
  if (!task) return null;
  const dueWall = task.dueAt ? wall(task.dueAt, ctx.timezone) : null;
  const due = dueWall ? (task.hasTime ? `${dueWall.date} ${dueWall.time}` : dueWall.date) : null;
  const base = {
    type: 'change' as const,
    target: 'task' as const,
    targetId: task.id,
    title: task.title,
    date: dueWall?.date ?? null,
    amountCents: null,
  };
  if (action === 'delete') return { ...base, action, diffs: [], apply: {}, revert: null };
  if (action === 'complete') {
    if (task.completedAt) return null;
    return { ...base, action, diffs: [], apply: {}, revert: { completed: false } };
  }

  const apply: UpdateTaskBody = {};
  const revert: UpdateTaskBody = {};
  const diffs: Diff[] = [];
  const title = str(p.descricao);
  if (title && title !== task.title) {
    apply.title = title.slice(0, 300);
    revert.title = task.title;
    diffs.push({ field: 'title', before: task.title, after: apply.title });
  }
  const date = str(p.data);
  const time = str(p.hora_inicio);
  let newDue: string | null | undefined;
  let newHasTime = task.hasTime;
  if (p.sem_prazo === true) {
    newDue = null;
  } else if (isDate(date) || (isTime(time) && dueWall)) {
    const day = isDate(date) ? date : dueWall!.date;
    if (isTime(time)) {
      newDue = instant(day, time, ctx.timezone).toISOString();
      newHasTime = true;
    } else if (task.hasTime && dueWall) {
      newDue = instant(day, dueWall.time, ctx.timezone).toISOString();
    } else {
      newDue = wallTimeToInstant(
        { ...parseDateString(day), hour: 0, minute: 0 },
        ctx.timezone
      ).toISOString();
      newHasTime = false;
    }
  }
  if (newDue !== undefined && newDue !== (task.dueAt?.toISOString() ?? null)) {
    const afterWall = newDue ? wall(new Date(newDue), ctx.timezone) : null;
    const after = afterWall
      ? newHasTime
        ? `${afterWall.date} ${afterWall.time}`
        : afterWall.date
      : null;
    apply.dueAt = newDue;
    apply.hasTime = Boolean(newDue && newHasTime);
    revert.dueAt = task.dueAt?.toISOString() ?? null;
    revert.hasTime = task.hasTime;
    diffs.push({ field: 'due', before: due, after });
  }
  if (diffs.length === 0) return null;
  return { ...base, action, diffs, apply, revert };
}

// ---------------------------------------------------------------- aplicar e desfazer

/** Aplica a mudança pelos serviços das telas (o Google e os lembretes seguem as mesmas regras). */
export async function applyChange(userId: string, draft: AssistantChangeDraft) {
  await run(userId, draft, draft.apply, draft.action);
}

/** Desfaz uma mudança aplicada. Apagar não volta. */
export async function revertChange(userId: string, draft: AssistantChangeDraft) {
  if (!draft.revert) return false;
  await run(userId, draft, draft.revert, 'update');
  return true;
}

async function run(
  userId: string,
  draft: AssistantChangeDraft,
  body: Record<string, unknown>,
  action: AssistantChangeDraft['action']
) {
  const id = draft.targetId;
  if (draft.target === 'transaction') {
    if (action === 'delete') return deleteTransaction(userId, id, 'single');
    return updateTransaction(userId, id, body as UpdateTransactionBody);
  }
  if (draft.target === 'event') {
    if (action === 'delete')
      return deleteEvent(userId, id, body as UpdateEventBody & { scope: 'single' | 'all' });
    return updateEvent(userId, id, body as UpdateEventBody);
  }
  if (action === 'delete') return deleteTask(userId, id);
  if (action === 'complete') return completeTask(userId, id);
  return updateTask(userId, id, body as UpdateTaskBody);
}
