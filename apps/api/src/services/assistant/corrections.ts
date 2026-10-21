import { dateStringInZone, instantToWallTime } from '@jottape/finance-engine';
import type { AssistantDraft, SaveAssistantCardBody } from '@jottape/schemas';

// O que o usuário trocou no rascunho antes de salvar, campo a campo. Só conta o que o Assistente
// tinha preenchido: completar o que faltava (o valor, o horário) não é correção.

export type CorrectedField =
  | 'kind'
  | 'amount'
  | 'date'
  | 'time'
  | 'end'
  | 'account'
  | 'toAccount'
  | 'category'
  | 'description'
  | 'installments'
  | 'title'
  | 'location'
  | 'notes'
  | 'allDay'
  | 'list';

const pad = (value: number) => String(value).padStart(2, '0');

/** Dia e "HH:MM" do instante no fuso. */
function wall(iso: string, timeZone: string) {
  const instant = new Date(iso);
  const time = instantToWallTime(instant, timeZone);
  return {
    date: dateStringInZone(instant, timeZone),
    time: `${pad(time.hour)}:${pad(time.minute)}`,
  };
}

const text = (value: string | null | undefined) => value?.trim() || null;

export function correctionsOf(
  draft: AssistantDraft,
  body: SaveAssistantCardBody,
  timeZone: string,
  /** A lista Entrada: tarefa sem lista no rascunho vai para ela. */
  inboxId: string | null
): CorrectedField[] {
  const fields = new Set<CorrectedField>();
  const changed = (field: CorrectedField, before: unknown, after: unknown) => {
    if (before === null || before === undefined) return;
    if (before !== (after ?? null)) fields.add(field);
  };

  if (draft.type === 'transaction') {
    const sheet = body.transaction;
    const picked = body.draft;
    if (sheet) {
      changed('kind', draft.kind, sheet.kind);
      changed('amount', draft.amountCents, sheet.amountCents);
      changed('date', draft.date, sheet.date);
      changed('account', draft.accountId, sheet.accountId);
      if (sheet.kind === 'TRANSFER') changed('toAccount', draft.toAccountId, sheet.toAccountId);
      else changed('category', draft.categoryId, sheet.categoryId);
      changed('description', text(draft.description), text(sheet.description));
      changed('installments', draft.installments ?? 1, sheet.installments ?? 1);
    } else if (picked) {
      if (picked.accountId !== undefined) changed('account', draft.accountId, picked.accountId);
      if (picked.toAccountId !== undefined) {
        changed('toAccount', draft.toAccountId, picked.toAccountId);
      }
      if (picked.amountCents !== undefined)
        changed('amount', draft.amountCents, picked.amountCents);
      if (picked.installments !== undefined) {
        changed('installments', draft.installments ?? 1, picked.installments ?? 1);
      }
    }
  } else if (draft.type === 'event' && body.event) {
    const sheet = body.event;
    changed('title', text(draft.title), text(sheet.title));
    changed('location', text(draft.location) ?? '', text(sheet.location) ?? '');
    changed('notes', text(draft.notes) ?? '', text(sheet.description) ?? '');
    changed('allDay', draft.allDay, sheet.allDay ?? false);
    if (sheet.allDay) {
      changed('date', draft.date, sheet.startAt.slice(0, 10));
    } else {
      const start = wall(sheet.startAt, timeZone);
      changed('date', draft.date, start.date);
      changed('time', draft.startTime, start.time);
      changed('end', draft.endTime, wall(sheet.endAt, timeZone).time);
    }
  } else if (draft.type === 'task' && body.task) {
    const sheet = body.task;
    changed('title', text(draft.title), text(sheet.title));
    changed('notes', text(draft.notes) ?? '', text(sheet.notes) ?? '');
    changed('list', draft.listId ?? inboxId, sheet.listId ?? inboxId);
    const due = sheet.dueAt ? wall(sheet.dueAt, timeZone) : null;
    changed('date', draft.date ?? '', due?.date ?? '');
    if (draft.time) changed('time', draft.time, sheet.hasTime && due ? due.time : null);
  }
  return [...fields];
}
