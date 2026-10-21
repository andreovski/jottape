import type {
  AccountResponse,
  AssistantCardResponse,
  AssistantChangeDraft,
  AssistantEventDraft,
  AssistantTaskDraft,
  AssistantTransactionDraft,
  AssistantUncertain,
  CategoryResponse,
  SaveAssistantCardBody,
} from '@jottape/schemas';
import { Check, CircleCheck, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';

import { newEventForm } from '@/components/agenda/event-form-model';
import { EventFormSheet } from '@/components/agenda/event-form-sheet';
import { CategoryIcon } from '@/components/finance/category-icon';
import { TransactionSheet } from '@/components/finance/transaction-sheet';
import { Button } from '@/components/ios/controls';
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
const KIND_LABEL = { EXPENSE: 'Despesa', INCOME: 'Receita', TRANSFER: 'Transferência' };

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

/** O que o Jotta montou: salvo (com Desfazer) ou rascunho para conferir. */
export function AssistantCard(props: Props) {
  const { draft } = props.card;
  if (draft.type === 'event') return <EventCard card={props.card} draft={draft} />;
  if (draft.type === 'task') return <TaskCard card={props.card} draft={draft} />;
  if (draft.type === 'change') return <ChangeCard card={props.card} draft={draft} />;
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

/** Linha "campo · valor" do recibo. Valor com pouca certeza fica laranja. */
export interface ReceiptField {
  label: string;
  value: ReactNode;
  uncertain?: boolean;
}

const STATUS_LABEL = {
  DRAFT: { text: 'Rascunho', color: 'var(--orange)' },
  SAVED: { text: 'Salvo', color: 'var(--green)' },
  UNDONE: { text: 'Desfeito', color: 'var(--label-2)' },
  DISCARDED: { text: 'Descartado', color: 'var(--label-3)' },
} as const;

/**
 * Recibo do que o Jotta montou: cabeçalho em mono (tipo e status), o principal em destaque e os
 * campos em pares. Rascunho abre a folha de edição pelo toque.
 */
export function Receipt({
  kind,
  status,
  hero,
  fields,
  onOpen,
  footer,
  dimmed,
}: {
  kind: string;
  status: { text: string; color: string; done?: boolean };
  hero: ReactNode;
  fields: ReceiptField[];
  /** Toque no corpo (só no rascunho). */
  onOpen?: () => void;
  footer?: ReactNode;
  dimmed?: boolean;
}) {
  const body = (
    <>
      <div className='min-w-0'>{hero}</div>
      {fields.length > 0 && (
        <dl className='mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5'>
          {fields.map((field) => (
            <Fragment key={field.label}>
              <dt className='text-label-3 pt-[3px] font-mono text-[11px] tracking-[0.06em] uppercase'>
                {field.label}
              </dt>
              <dd className={cn('text-subhead min-w-0 truncate', field.uncertain && 'text-orange')}>
                {field.value}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </>
  );
  return (
    <div
      className={cn(
        'bg-surface overflow-hidden rounded-[14px] shadow-[inset_0_0_0_0.5px_var(--separator)]',
        dimmed && 'opacity-50'
      )}
    >
      <div className='border-separator text-label-2 flex items-center gap-2 border-b border-dashed px-3.5 py-2 font-mono text-[10.5px] tracking-[0.08em] uppercase'>
        <span className='min-w-0 truncate'>{kind}</span>
        <span
          className='ml-auto inline-flex shrink-0 items-center gap-1 font-semibold'
          style={{ color: status.color }}
        >
          {status.done && <Check className='size-3' strokeWidth={3} />}
          {status.text}
        </span>
      </div>
      {onOpen ? (
        <button
          type='button'
          className='block w-full px-3.5 py-3 text-left active:opacity-60'
          onClick={onOpen}
        >
          {body}
        </button>
      ) : (
        <div className='px-3.5 py-3'>{body}</div>
      )}
      {footer}
    </div>
  );
}

/** Rodapé do recibo salvo: Desfazer e onde ficou ("No extrato"). */
function SavedFooter({
  label,
  onUndo,
  loading,
}: {
  label?: string;
  onUndo?: () => void;
  loading: boolean;
}) {
  return (
    <div className='hairline-t flex items-stretch'>
      {onUndo && (
        <Button
          variant='plain'
          size='md'
          className='flex-1 rounded-none'
          loading={loading}
          onClick={onUndo}
        >
          <RotateCcw className='size-3.5' strokeWidth={2.5} /> Desfazer
        </Button>
      )}
      {label && (
        <span className='text-label-3 flex shadow-[inset_0.5px_0_0_var(--separator)] flex-1 items-center justify-center font-mono text-[11px] tracking-[0.06em] uppercase'>
          {label}
        </span>
      )}
    </div>
  );
}

function CardShell({
  card,
  actions,
  kind,
  hero,
  fields,
  savedLabel,
  prompt,
  sheet,
}: {
  card: AssistantCardResponse;
  actions: Actions;
  kind: string;
  hero: ReactNode;
  fields: ReceiptField[];
  savedLabel: string;
  /** Pergunta ou aviso do rascunho (contas num toque, "falta o horário"). */
  prompt?: ReactNode;
  sheet: ReactNode;
}) {
  const { save, undo, discard, busy, openSheet } = actions;
  const open = card.status === 'DRAFT' || card.status === 'UNDONE';
  const uncertain = card.uncertain;
  const status = STATUS_LABEL[card.status];

  return (
    <>
      <Receipt
        kind={kind}
        status={{ ...status, done: card.status === 'SAVED' }}
        hero={hero}
        fields={fields}
        dimmed={card.status === 'DISCARDED'}
        onOpen={open ? openSheet : undefined}
        footer={
          card.status === 'SAVED' ? (
            <SavedFooter
              label={savedLabel}
              loading={undo.isPending}
              onUndo={() => undo.mutate({ id: card.id })}
            />
          ) : open ? (
            <div className='hairline-t space-y-3 px-3.5 pt-2.5 pb-3'>
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
          ) : undefined
        }
      />
      {sheet}
    </>
  );
}

/** Título do recibo de evento, tarefa ou mudança. */
function HeroTitle({ children, struck }: { children: ReactNode; struck?: boolean }) {
  return (
    <div className={cn('text-headline truncate', struck && 'text-label-2 line-through')}>
      {children}
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
  const undone = card.status === 'UNDONE';
  return (
    <CardShell
      card={card}
      actions={actions}
      kind={`Lançamento · ${KIND_LABEL[draft.kind]}`}
      hero={
        <span
          className={cn(
            'font-rounded numeric text-title-2 font-bold',
            undone && 'text-label-3 line-through'
          )}
          style={undone ? undefined : { color: KIND_COLOR[draft.kind] }}
        >
          {draft.amountCents ? `${sign}${format(draft.amountCents)}` : '—'}
        </span>
      }
      fields={[
        { label: 'Descrição', value: draft.description || '—' },
        ...(draft.kind === 'TRANSFER'
          ? []
          : [
              {
                label: 'Categoria',
                value: category ? (
                  <span className='inline-flex items-center gap-1.5 align-middle'>
                    <CategoryIcon category={category} kind={draft.kind} size='sm' />
                    <span className='truncate'>{category.name}</span>
                  </span>
                ) : (
                  'Sem categoria'
                ),
                uncertain: card.uncertain.includes('category'),
              },
            ]),
        {
          label: draft.kind === 'TRANSFER' ? 'Contas' : 'Conta',
          value: where ?? 'Falta a conta',
          uncertain:
            card.uncertain.includes('account') ||
            card.uncertain.includes('toAccount') ||
            missingAccount ||
            missingDestination,
        },
        { label: 'Data', value: relativeDay(draft.date) },
        ...(draft.installments ? [{ label: 'Parcelas', value: `${draft.installments}x` }] : []),
      ]}
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
      notes: draft.notes ?? '',
      allDay: draft.allDay,
      ...(draft.startTime ? { startTime: draft.startTime } : {}),
      ...(draft.startTime ? { endTime: draft.endTime ?? draft.startTime } : {}),
    };
  };

  return (
    <CardShell
      card={card}
      actions={actions}
      kind='Evento'
      hero={<HeroTitle struck={card.status === 'UNDONE'}>{draft.title}</HeroTitle>}
      fields={[
        { label: 'Dia', value: relativeDay(draft.date) },
        {
          label: 'Horário',
          value: when || 'Falta o horário',
          uncertain: card.missing.includes('time'),
        },
        ...(draft.location ? [{ label: 'Local', value: draft.location }] : []),
        ...(draft.notes ? [{ label: 'Notas', value: draft.notes }] : []),
      ]}
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
      kind='Tarefa'
      hero={<HeroTitle struck={card.status === 'UNDONE'}>{draft.title}</HeroTitle>}
      fields={[
        {
          label: 'Lista',
          value: list?.name ?? 'Entrada',
          uncertain: card.uncertain.includes('list'),
        },
        { label: 'Prazo', value: due },
        ...(draft.notes ? [{ label: 'Notas', value: draft.notes }] : []),
      ]}
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
              notes: draft.notes ?? undefined,
            }}
            onCreate={(task) => actions.saveFrom({ task })}
          />
        )
      }
    />
  );
}

// ---------------------------------------------------------------- mudança

const CHANGE_FIELD: Record<AssistantChangeDraft['diffs'][number]['field'], string> = {
  description: 'Descrição',
  amount: 'Valor',
  date: 'Data',
  category: 'Categoria',
  account: 'Conta',
  title: 'Título',
  start: 'Início',
  end: 'Fim',
  location: 'Local',
  due: 'Prazo',
};

const CHANGE_ACTION = {
  update: { button: 'Mudar', done: 'Mudado', color: 'var(--blue)', icon: Pencil },
  delete: { button: 'Apagar', done: 'Apagado', color: 'var(--red)', icon: Trash2 },
  complete: { button: 'Concluir', done: 'Concluído', color: 'var(--orange)', icon: CircleCheck },
} as const;

const TARGET_LABEL = { transaction: 'Lançamento', event: 'Evento', task: 'Tarefa' } as const;

/** Mudança no que já existe: mostra antes e depois e só vale com a confirmação. */
function ChangeCard({ card, draft }: { card: AssistantCardResponse; draft: AssistantChangeDraft }) {
  const save = useSaveAssistantCard();
  const undo = useUndoAssistantCard();
  const discard = useDiscardAssistantCard();
  const { format } = useHiddenMoney();
  const busy = save.isPending || undo.isPending || discard.isPending;
  const action = CHANGE_ACTION[draft.action];
  const Icon = action.icon;
  const open = card.status === 'DRAFT' || card.status === 'UNDONE';

  const show = (
    field: AssistantChangeDraft['diffs'][number]['field'],
    value: string | number | null
  ) => {
    if (value === null || value === '') return '—';
    if (field === 'amount' && typeof value === 'number') return format(value);
    if ((field === 'date' || field === 'due') && typeof value === 'string') {
      const [day, time] = value.split(' ');
      return `${relativeDay(day)}${time ? `, ${time}` : ''}`;
    }
    return String(value);
  };

  const status =
    card.status === 'SAVED'
      ? { text: action.done, color: 'var(--green)', done: true }
      : STATUS_LABEL[card.status];

  return (
    <Receipt
      kind={`Mudança · ${TARGET_LABEL[draft.target]}`}
      status={status}
      dimmed={card.status === 'DISCARDED'}
      hero={
        <div className='flex items-center gap-2.5'>
          <IconChip color={action.color} size='sm'>
            <Icon strokeWidth={2.5} />
          </IconChip>
          <HeroTitle struck={card.status === 'SAVED' && draft.action === 'delete'}>
            {draft.title}
          </HeroTitle>
        </div>
      }
      fields={[
        ...(draft.date ? [{ label: 'Data', value: relativeDay(draft.date) }] : []),
        ...(draft.amountCents !== null
          ? [{ label: 'Valor', value: format(draft.amountCents) }]
          : []),
        ...draft.diffs.map((diff) => ({
          label: CHANGE_FIELD[diff.field],
          value: (
            <>
              <span className='text-label-2 line-through'>{show(diff.field, diff.before)}</span>
              <span className='text-label-3'> → </span>
              <span className='font-medium'>{show(diff.field, diff.after)}</span>
            </>
          ),
        })),
      ]}
      footer={
        card.status === 'SAVED' && draft.revert ? (
          <SavedFooter loading={undo.isPending} onUndo={() => undo.mutate({ id: card.id })} />
        ) : open ? (
          <div className='hairline-t flex gap-2 px-3.5 pt-2.5 pb-3'>
            <Button
              variant={draft.action === 'delete' ? 'destructive' : 'filled'}
              size='md'
              className='flex-1'
              disabled={busy}
              loading={save.isPending}
              onClick={() => save.mutate({ id: card.id })}
            >
              {card.status === 'UNDONE' ? `${action.button} de novo` : action.button}
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
        ) : undefined
      }
    />
  );
}
