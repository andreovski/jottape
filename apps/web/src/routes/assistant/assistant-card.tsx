import type {
  AccountResponse,
  AssistantCardResponse,
  AssistantUncertain,
  CategoryResponse,
} from '@jottape/schemas';
import { Check, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { CategoryIcon } from '@/components/finance/category-icon';
import { TransactionSheet } from '@/components/finance/transaction-sheet';
import { Button, Pill } from '@/components/ios/controls';
import {
  useDiscardAssistantCard,
  useSaveAssistantCard,
  useUndoAssistantCard,
} from '@/features/assistant';
import { relativeDay } from '@/lib/format';
import { useHiddenMoney } from '@/lib/hidden-money';
import { cn } from '@/lib/utils';

const KIND_COLOR = { EXPENSE: 'var(--red)', INCOME: 'var(--green)', TRANSFER: 'var(--foreground)' };

const UNCERTAIN_LABEL: Record<AssistantUncertain, string> = {
  kind: 'o tipo',
  account: 'a conta',
  toAccount: 'o destino',
  category: 'a categoria',
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

/** O lançamento que o Assistente montou: salvo (com Desfazer) ou rascunho para conferir. */
export function AssistantCard({ card, accounts, categories }: Props) {
  const save = useSaveAssistantCard();
  const undo = useUndoAssistantCard();
  const discard = useDiscardAssistantCard();
  const { format } = useHiddenMoney();
  const [editing, setEditing] = useState(false);

  const { draft } = card;
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name;
  const category = categories.find((c) => c.id === draft.categoryId) ?? null;
  const busy = save.isPending || undo.isPending || discard.isPending;
  const open = card.status === 'DRAFT' || card.status === 'UNDONE';
  const complete = card.missing.length === 0;

  const where =
    draft.kind === 'TRANSFER'
      ? `${accountName(draft.accountId) ?? '?'} → ${accountName(draft.toAccountId) ?? '?'}`
      : accountName(draft.accountId);
  const details = [
    category?.name,
    where,
    relativeDay(draft.date),
    draft.installments ? `em ${draft.installments}x` : null,
  ].filter(Boolean);

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
  const chooseAccount = (id: string) =>
    save.mutate({
      id: card.id,
      body: { draft: missingDestination ? { toAccountId: id } : { accountId: id } },
    });

  const uncertain = card.uncertain.filter((field) => field !== 'category' || draft.categoryId);

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
        onClick={() => setEditing(true)}
        disabled={!open}
      >
        <CategoryIcon category={category} kind={draft.kind} />
        <div className='min-w-0 flex-1'>
          <div className='text-body truncate'>{draft.description}</div>
          <div className='text-footnote text-label-2 truncate'>{details.join(' · ')}</div>
        </div>
        <div className='flex flex-col items-end gap-1'>
          <span
            className={cn(
              'font-rounded numeric text-headline',
              card.status === 'UNDONE' && 'text-label-3 line-through'
            )}
            style={card.status === 'UNDONE' ? undefined : { color: KIND_COLOR[draft.kind] }}
          >
            {draft.amountCents
              ? `${draft.kind === 'EXPENSE' ? '−' : draft.kind === 'INCOME' ? '+' : ''}${format(draft.amountCents)}`
              : '—'}
          </span>
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
          <span className='text-footnote text-label-2'>
            {card.transactions.length > 1 ? `${card.transactions.length} parcelas` : 'No extrato'}
          </span>
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
          {(missingAccount || missingDestination) && choices.length > 0 ? (
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
                    disabled={busy}
                    onClick={() => chooseAccount(account.id)}
                  >
                    {account.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : card.missing.includes('amount') ? (
            <div className='text-footnote text-label-2'>Toque no lançamento para pôr o valor.</div>
          ) : (
            uncertain.length > 0 && (
              <div className='text-footnote text-orange'>
                Confira {joinNatural(uncertain.map((field) => UNCERTAIN_LABEL[field]))}.
              </div>
            )
          )}
          <div className='flex gap-2'>
            <Button
              variant='filled'
              size='md'
              className='flex-1'
              disabled={!complete || busy}
              loading={save.isPending}
              onClick={() => save.mutate({ id: card.id })}
            >
              {card.status === 'UNDONE' ? 'Salvar de novo' : 'Salvar'}
            </Button>
            <Button variant='gray' size='md' disabled={busy} onClick={() => setEditing(true)}>
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

      <TransactionSheet
        open={editing}
        onOpenChange={setEditing}
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
        onCreate={(transaction) =>
          save.mutateAsync({ id: card.id, body: { transaction } }).then(
            () => true,
            () => false
          )
        }
      />
    </div>
  );
}
