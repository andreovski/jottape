import type {
  AccountResponse,
  AssistantCardResponse,
  AssistantEventDraft,
  AssistantTaskDraft,
  AssistantTransactionDraft,
  AssistantUncertain,
  CategoryResponse,
  SaveAssistantCardBody,
} from '@jottape/schemas';
import { CalendarDays, Check, CircleCheck, RotateCcw } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { newEventForm } from '@/components/agenda/event-form-model';
import { EventFormSheet } from '@/components/agenda/event-form-sheet';
import { CategoryIcon } from '@/components/finance/category-icon';
import { TransactionSheet } from '@/components/finance/transaction-sheet';
import { Button, Pill } from '@/components/ios/controls';
import { IconChip } from '@/components/ios/list';
import { TaskSheet } from '@/components/tasks/task-sheet';
import {
  useDiscardAssistantCard,
  useSaveAssistantCard,
  useUndoAssistantCard,
} from '@/features/assistant';
import { useMe } from '@/features/auth';
import { useGoogleStatus } from '@/features/google';
import { useTaskLists } from '@/features/tasks';
import { appTimeZone, relativeDay } from '@/lib/format';
import { useHiddenMoney } from '@/lib/hidden-money';
import { cn } from '@/lib/utils';

const KIND_COLOR = { EXPENSE: 'var(--red)', INCOME: 'var(--green)', TRANSFER: 'var(--foreground)' };

const UNCERTAIN_LABEL: Record<AssistantUncertain, string> = {
  kind: 'o tipo',
  account: 'a conta',
  toAccount: 'o destino',
  category: 'a categoria',
  list: 'a lista',
};

function joinNatural(parts: string[]) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

interface Props {
  card: AssistantCardResponse;
  accounts: AccountResponse[];
  categories: CategoryResponse[];
}

/** O que o Assistente montou: salvo (com Desfazer) ou rascunho para conferir. */
export function AssistantCard(props: Props) {
  const { draft } = props.card;
  if (draft.type === 'event') return <EventCard card={props.card} draft={draft} />;
  if (draft.type === 'task') return <TaskCard card={props.card} draft={draft} />;
  return <TransactionCard {...props} draft={draft} />;
}

/** Salvar, desfazer e descartar, com a folha de edição aberta pelo toque no cartão. */
function useCardActions(card: AssistantCardResponse) {
  const save = useSaveAssistantCard();
  const undo = useUndoAssistantCard();
  const discard = useDiscardAssistantCard();
  // A folha remonta a cada abertura (a `key` muda): começa sempre do rascunho.
  const [sheet, setSheet] = useState({ open: false, key: 0 });
  return {
    save,
    undo,
    discard,
    busy: save.isPending || undo.isPending || discard.isPending,
    sheet,
    openSheet: () => setSheet((s) => ({ open: true, key: s.key + 1 })),
    setSheetOpen: (open: boolean) => setSheet((s) => ({ ...s, open })),
    /** Salva com o que veio da folha; a folha só fecha se deu certo. */
    saveFrom: (body: SaveAssistantCardBody) =>
      save.mutateAsync({ id: card.id, body }).then(
        () => true,
        () => false
      ),
  };
}

type Actions = ReturnType<typeof useCardActions>;

function CardShell({
  card,
  actions,
  icon,
  title,
  details,
  trailing,
  savedLabel,
  prompt,
  sheet,
}: {
  card: AssistantCardResponse;
  actions: Actions;
  icon: ReactNode;
  title: string;
  details: (string | null | undefined | false)[];
  trailing?: ReactNode;
  savedLabel: string;
  /** Pergunta ou aviso do rascunho (contas num toque, "falta o horário"). */
  prompt?: ReactNode;
  sheet: ReactNode;
}) {
  const { save, undo, discard, busy, openSheet } = actions;
  const open = card.status === 'DRAFT' || card.status === 'UNDONE';
  const uncertain = card.uncertain;

  return (
    <div
      className={cn(
        'bg-surface rounded-[var(--radius)]',
        card.status === 'DISCARDED' && 'opacity-50'
      )}
    >
      <button
        type='button'
        className='flex w-full items-center gap-3 px-4 py-3 text-left active:opacity-60 disabled:active:opacity-100'
        onClick={openSheet}
        disabled={!open}
      >
        {icon}
        <div className='min-w-0 flex-1'>
          <div className={cn('text-body truncate', card.status === 'UNDONE' && 'text-label-2')}>
            {title}
          </div>
          <div className='text-footnote text-label-2 truncate'>
            {details.filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className='flex flex-col items-end gap-1'>
          {trailing}
          {card.status === 'SAVED' && (
            <Pill color='var(--green)'>
              <Check className='size-3' strokeWidth={3} /> Salvo
            </Pill>
          )}
          {card.status === 'UNDONE' && <Pill>Desfeito</Pill>}
          {card.status === 'DISCARDED' && <Pill>Descartado</Pill>}
        </div>
      </button>

      {card.status === 'SAVED' && (
        <div className='hairline-t flex items-center justify-between px-4 py-1.5'>
          <span className='text-footnote text-label-2'>{savedLabel}</span>
          <Button
            variant='plain'
            size='sm'
            loading={undo.isPending}
            onClick={() => undo.mutate({ id: card.id })}
          >
            <RotateCcw className='size-3.5' strokeWidth={2.5} /> Desfazer
          </Button>
        </div>
      )}

      {open && (
        <div className='hairline-t space-y-3 px-4 pt-2.5 pb-3'>
          {prompt ??
            (uncertain.length > 0 && (
              <div className='text-footnote text-orange'>
                Confira {joinNatural(uncertain.map((field) => UNCERTAIN_LABEL[field]))}.
              </div>
            ))}
          <div className='flex gap-2'>
            <Button
              variant='filled'
              size='md'
              className='flex-1'
              disabled={card.missing.length > 0 || busy}
              loading={save.isPending}
              onClick={() => save.mutate({ id: card.id })}
            >
              {card.status === 'UNDONE' ? 'Salvar de novo' : 'Salvar'}
            </Button>
            <Button variant='gray' size='md' disabled={busy} onClick={openSheet}>
              Editar
            </Button>
            {card.status === 'DRAFT' && (
              <Button
                variant='gray'
                size='md'
                className='text-label-2'
                disabled={busy}
                onClick={() => discard.mutate({ id: card.id })}
              >
                Descartar
              </Button>
            )}
          </div>
        </div>
      )}

      {sheet}
    </div>
  );
}

// ---------------------------------------------------------------- lançamento

function TransactionCard({
  card,
  draft,
  accounts,
  categories,
}: Props & { draft: AssistantTransactionDraft }) {
  const actions = useCardActions(card);
  const { format } = useHiddenMoney();
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name;
  const category = categories.find((c) => c.id === draft.categoryId) ?? null;

  const where =
    draft.kind === 'TRANSFER'
      ? `${accountName(draft.accountId) ?? '?'} → ${accountName(draft.toAccountId) ?? '?'}`
      : accountName(draft.accountId);

  // Contas para escolher num toque quando ela falta (receita não entra no cartão).
  const missingAccount = card.missing.includes('account');
  const missingDestination = card.missing.includes('toAccount');
  const choices = accounts.filter(
    (a) =>
      !a.archived &&
      (missingDestination
        ? a.id !== draft.accountId
        : draft.kind !== 'INCOME' || a.type !== 'CREDIT_CARD')
  );

  let prompt: ReactNode;
  if ((missingAccount || missingDestination) && choices.length > 0) {
    prompt = (
      <div>
        <div className='text-footnote text-label-2 mb-2'>
          {missingDestination ? 'Para qual conta?' : 'De qual conta?'}
        </div>
        <div className='flex flex-wrap gap-2'>
          {choices.map((account) => (
            <Button
              key={account.id}
              variant='gray'
              size='sm'
              disabled={actions.busy}
              onClick={() =>
                actions.save.mutate({
                  id: card.id,
                  body: {
                    draft: missingDestination
                      ? { toAccountId: account.id }
                      : { accountId: account.id },
                  },
                })
              }
            >
              {account.name}
            </Button>
          ))}
        </div>
      </div>
    );
  } else if (card.missing.includes('amount')) {
    prompt = (
      <div className='text-footnote text-label-2'>Toque no lançamento para pôr o valor.</div>
    );
  }

  const sign = draft.kind === 'EXPENSE' ? '−' : draft.kind === 'INCOME' ? '+' : '';
  return (
    <CardShell
      card={card}
      actions={actions}
      icon={<CategoryIcon category={category} kind={draft.kind} />}
      title={draft.description}
      details={[
        category?.name,
        where,
        relativeDay(draft.date),
        draft.installments ? `em ${draft.installments}x` : null,
      ]}
      trailing={
        <span
          className={cn(
            'font-rounded numeric text-headline',
            card.status === 'UNDONE' && 'text-label-3 line-through'
          )}
          style={card.status === 'UNDONE' ? undefined : { color: KIND_COLOR[draft.kind] }}
        >
          {draft.amountCents ? `${sign}${format(draft.amountCents)}` : '—'}
        </span>
      }
      savedLabel={
        card.transactions.length > 1 ? `${card.transactions.length} parcelas` : 'No extrato'
      }
      prompt={prompt}
      sheet={
        <TransactionSheet
          open={actions.sheet.open}
          onOpenChange={actions.setSheetOpen}
          defaults={{
            kind: draft.kind,
            amountCents: draft.amountCents ?? undefined,
            description: draft.description,
            categoryId: draft.categoryId ?? undefined,
            accountId: draft.accountId ?? undefined,
            toAccountId: draft.toAccountId ?? undefined,
            date: draft.date,
            installments: draft.installments ?? undefined,
          }}
          onCreate={(transaction) => actions.saveFrom({ transaction })}
        />
      }
    />
  );
}

// ---------------------------------------------------------------- evento

function EventCard({ card, draft }: { card: AssistantCardResponse; draft: AssistantEventDraft }) {
  const actions = useCardActions(card);
  const me = useMe().data;
  const status = useGoogleStatus().data;

  const when = draft.allDay
    ? 'Dia inteiro'
    : draft.startTime && `${draft.startTime}${draft.endTime ? ` – ${draft.endTime}` : ''}`;

  // A folha começa do rascunho: dia, horário (ou a próxima hora cheia) e o calendário padrão.
  const initial = () => {
    const base = newEventForm({
      date: draft.date,
      now: new Date(),
      timeZone: appTimeZone(),
      defaultReminderMin: me?.defaultReminderMin,
      calendarId: status?.connected ? (status.defaultCalendarId ?? null) : null,
    });
    return {
      ...base,
      title: draft.title,
      location: draft.location ?? '',
      allDay: draft.allDay,
      ...(draft.startTime ? { startTime: draft.startTime } : {}),
      ...(draft.startTime ? { endTime: draft.endTime ?? draft.startTime } : {}),
    };
  };

  return (
    <CardShell
      card={card}
      actions={actions}
      icon={
        <IconChip color='var(--red)'>
          <CalendarDays strokeWidth={2.25} />
        </IconChip>
      }
      title={draft.title}
      details={[relativeDay(draft.date), when, draft.location]}
      savedLabel='Na agenda'
      prompt={
        card.missing.includes('time') ? (
          <div className='text-footnote text-label-2'>
            Falta o horário: toque no evento para escolher.
          </div>
        ) : undefined
      }
      sheet={
        actions.sheet.key > 0 && (
          <EventFormSheet
            key={actions.sheet.key}
            mode={{ kind: 'create', initial: initial() }}
            open={actions.sheet.open}
            onOpenChange={actions.setSheetOpen}
            onCreate={(event) => actions.saveFrom({ event })}
          />
        )
      }
    />
  );
}

// ---------------------------------------------------------------- tarefa

function TaskCard({ card, draft }: { card: AssistantCardResponse; draft: AssistantTaskDraft }) {
  const actions = useCardActions(card);
  const lists = useTaskLists().data ?? [];
  const list = lists.find((l) => (draft.listId ? l.id === draft.listId : l.isInbox));

  const due = draft.date
    ? `${relativeDay(draft.date)}${draft.time ? `, ${draft.time}` : ''}`
    : 'Sem prazo';

  return (
    <CardShell
      card={card}
      actions={actions}
      icon={
        <IconChip color='var(--orange)'>
          <CircleCheck strokeWidth={2.25} />
        </IconChip>
      }
      title={draft.title}
      details={[list?.name, due]}
      savedLabel='Nas tarefas'
      sheet={
        actions.sheet.key > 0 && (
          <TaskSheet
            key={actions.sheet.key}
            open={actions.sheet.open}
            onOpenChange={actions.setSheetOpen}
            task={null}
            defaults={{
              listId: draft.listId ?? undefined,
              title: draft.title,
              date: draft.date ?? undefined,
              time: draft.time ?? undefined,
            }}
            onCreate={(task) => actions.saveFrom({ task })}
          />
        )
      }
    />
  );
}
