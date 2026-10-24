import { describeRRule } from '@jottape/finance-engine';
import type {
  CreateTransactionBody,
  RecurrenceScope,
  TransactionKind,
  TransactionResponse,
  UpdateTransactionBody,
} from '@jottape/schemas';
import { Minus, Plus, Repeat } from 'lucide-react';
import { useState } from 'react';

import { Button, Segmented, Switch } from '@/components/ios/controls';
import {
  AmountInput,
  DateInput,
  FieldRow,
  SelectInput,
  TextArea,
  TextInput,
} from '@/components/ios/fields';
import { Section } from '@/components/ios/list';
import { ActionSheet, Sheet } from '@/components/ios/sheet';
import {
  useAccounts,
  useCategories,
  useCreateTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
} from '@/features/finance';
import { todayKey } from '@/lib/format';
import { useFormErrors } from '@/lib/use-form-errors';

import { CategoryPicker } from './category-picker';
import {
  categoryTree,
  defaultStatus,
  installmentPreview,
  type Repetition,
  REPETITION_OPTIONS,
  repetitionFields,
} from './finance-utils';

export interface TransactionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Com ele, a folha edita; sem ele, cria. */
  transaction?: TransactionResponse;
  defaults?: Partial<{
    kind: TransactionKind;
    accountId: string;
    date: string;
    amountCents: number;
    description: string;
    categoryId: string;
    toAccountId: string;
    installments: number;
  }>;
  /** Cria por outro caminho (o Assistente salva o rascunho). Devolve se deu certo. */
  onCreate?: (body: CreateTransactionBody) => Promise<boolean>;
}

const KIND_OPTIONS: { value: TransactionKind; label: string }[] = [
  { value: 'EXPENSE', label: 'Despesa' },
  { value: 'INCOME', label: 'Receita' },
  { value: 'TRANSFER', label: 'Transferência' },
];

const AMOUNT_COLORS: Record<TransactionKind, string> = {
  EXPENSE: 'var(--red)',
  INCOME: 'var(--green)',
  TRANSFER: 'var(--foreground)',
};

/**
 * Folha de lançamento (criar e editar). O formulário remonta a cada abertura, então sempre começa
 * do lançamento (ou dos padrões) atual.
 */
export function TransactionSheet(props: TransactionSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((value) => value + 1);
  }
  return <TransactionForm key={`${props.transaction?.id ?? 'new'}-${session}`} {...props} />;
}

type PendingAction = { type: 'save' } | { type: 'delete' } | null;

function TransactionForm({
  open,
  onOpenChange,
  transaction,
  defaults,
  onCreate,
}: TransactionSheetProps) {
  const today = todayKey();
  const editing = Boolean(transaction);
  const { data: accounts = [] } = useAccounts({ archived: true });
  const { data: categories = [] } = useCategories();
  const create = useCreateTransaction();
  const update = useUpdateTransaction();
  const remove = useDeleteTransaction();

  const activeAccounts = accounts.filter(
    (a) => !a.archived || a.id === transaction?.accountId || a.id === transaction?.toAccountId
  );
  const firstAccount = activeAccounts.find((a) => a.type !== 'CREDIT_CARD') ?? activeAccounts[0];

  const [kind, setKind] = useState<TransactionKind>(
    transaction?.kind ?? defaults?.kind ?? 'EXPENSE'
  );
  const [amount, setAmount] = useState(transaction?.amountCents ?? defaults?.amountCents ?? 0);
  const [description, setDescription] = useState(
    transaction?.description ?? defaults?.description ?? ''
  );
  const [categoryId, setCategoryId] = useState(
    transaction?.categoryId ?? defaults?.categoryId ?? ''
  );
  const [accountId, setAccountId] = useState(transaction?.accountId ?? defaults?.accountId ?? '');
  const [toAccountId, setToAccountId] = useState(
    transaction?.toAccountId ?? defaults?.toAccountId ?? ''
  );
  const [date, setDate] = useState(transaction?.date ?? defaults?.date ?? today);
  const [done, setDone] = useState(
    transaction
      ? transaction.status === 'DONE'
      : defaultStatus(defaults?.date ?? today, today) === 'DONE'
  );
  const [statusTouched, setStatusTouched] = useState(editing);
  const [repetition, setRepetition] = useState<Repetition>(
    defaults?.installments ? 'installments' : 'none'
  );
  const [installments, setInstallments] = useState(defaults?.installments ?? 2);
  const [notes, setNotes] = useState(transaction?.notes ?? '');
  const [pending, setPending] = useState<PendingAction>(null);

  // Conta escolhida: a do formulário, ou a primeira quando as contas carregam depois.
  const effectiveAccountId = accountId || firstAccount?.id || '';
  const recurring = Boolean(transaction?.recurrenceId);
  const busy = create.isPending || update.isPending || remove.isPending;

  const categoryGroups = categoryTree(categories, kind);
  const accountOptions = activeAccounts.map((a) => ({ value: a.id, label: a.name }));
  const destinationOptions = accountOptions.filter((a) => a.value !== effectiveAccountId);

  const { errors, validate } = useFormErrors({
    amount: amount <= 0 && 'Informe o valor.',
    description: !description.trim() && 'Informe a descrição.',
    account: !effectiveAccountId && 'Crie uma conta antes de lançar.',
    toAccount:
      kind === 'TRANSFER' &&
      (!toAccountId || toAccountId === effectiveAccountId) &&
      'Escolha a conta de destino.',
  });

  const doneLabel = kind === 'INCOME' ? 'Recebido' : kind === 'TRANSFER' ? 'Efetivada' : 'Pago';
  const preview = repetition === 'installments' ? installmentPreview(amount, installments) : null;

  const close = () => onOpenChange(false);

  // Erros de mutação já viram toast (query-client); aqui só não fechamos a folha.
  async function save(scope: RecurrenceScope = 'single') {
    const fields = {
      amountCents: amount,
      description: description.trim(),
      accountId: effectiveAccountId,
      toAccountId: kind === 'TRANSFER' ? toAccountId : null,
      categoryId: kind === 'TRANSFER' ? null : categoryId || null,
      date,
      notes: notes.trim() || null,
      status: done ? ('DONE' as const) : ('PLANNED' as const),
    };
    if (transaction) {
      const body: Partial<UpdateTransactionBody> & { id: string } = {
        id: transaction.id,
        ...fields,
        scope,
      };
      const ok = await update.mutateAsync(body).then(
        () => true,
        () => false
      );
      if (!ok) return;
    } else {
      const body: CreateTransactionBody = {
        kind,
        ...fields,
        ...repetitionFields(repetition, installments),
      };
      const ok = onCreate
        ? await onCreate(body)
        : await create.mutateAsync(body).then(
            () => true,
            () => false
          );
      if (!ok) return;
    }
    close();
  }

  async function destroy(scope: RecurrenceScope = 'single') {
    if (!transaction) return;
    const ok = await remove.mutateAsync({ id: transaction.id, scope }).then(
      () => true,
      () => false
    );
    if (ok) close();
  }

  function confirm() {
    if (busy || !validate()) return;
    if (recurring) setPending({ type: 'save' });
    else void save();
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        tall
        title={editing ? 'Editar Lançamento' : 'Novo Lançamento'}
        confirmLabel={editing ? 'OK' : 'Adicionar'}
        confirmDisabled={busy}
        onConfirm={confirm}
      >
        {!editing ? (
          <Segmented
            value={kind}
            onChange={(value) => {
              setKind(value);
              setCategoryId('');
            }}
            options={KIND_OPTIONS}
          />
        ) : (
          <div className='text-footnote text-label-2 text-center'>
            {KIND_OPTIONS.find((option) => option.value === kind)?.label}
          </div>
        )}

        <AmountInput
          value={amount}
          onChange={setAmount}
          color={AMOUNT_COLORS[kind]}
          error={errors.amount}
        />

        <Section>
          <FieldRow error={errors.description}>
            <TextInput
              placeholder='Descrição'
              value={description}
              maxLength={120}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FieldRow>
          {kind !== 'TRANSFER' && (
            <FieldRow label='Categoria'>
              <CategoryPicker
                value={categoryId}
                onChange={setCategoryId}
                groups={categoryGroups}
                kind={kind}
                placeholder='Nenhuma'
              />
            </FieldRow>
          )}
          <FieldRow label={kind === 'TRANSFER' ? 'De' : 'Conta'} error={errors.account}>
            <SelectInput
              value={effectiveAccountId}
              onChange={(value) => {
                setAccountId(value);
                if (value === toAccountId) setToAccountId('');
              }}
              placeholder={accountOptions.length ? undefined : 'Nenhuma conta'}
              options={accountOptions}
            />
          </FieldRow>
          {kind === 'TRANSFER' && (
            <FieldRow label='Para' error={errors.toAccount}>
              <SelectInput
                value={toAccountId}
                onChange={setToAccountId}
                placeholder='Escolher'
                options={destinationOptions}
              />
            </FieldRow>
          )}
        </Section>

        <Section>
          <FieldRow label='Data'>
            <DateInput
              value={date}
              required
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return;
                setDate(value);
                if (!statusTouched) setDone(defaultStatus(value, today) === 'DONE');
              }}
            />
          </FieldRow>
          <FieldRow label={doneLabel}>
            <Switch
              checked={done}
              label={doneLabel}
              onChange={(value) => {
                setDone(value);
                setStatusTouched(true);
              }}
            />
          </FieldRow>
        </Section>

        {!editing ? (
          <Section
            header='Repetição'
            footer={
              repetition === 'installments'
                ? 'O valor digitado é o total; as parcelas caem uma por mês.'
                : repetition !== 'none'
                  ? 'Os próximos 12 meses entram como previstos.'
                  : undefined
            }
          >
            <FieldRow label='Repetir'>
              <SelectInput
                value={repetition}
                onChange={(value) => setRepetition(value as Repetition)}
                options={REPETITION_OPTIONS}
              />
            </FieldRow>
            {repetition === 'installments' && (
              // Não é FieldRow: um <label> em volta repassaria o toque ao primeiro botão.
              <div className='flex min-h-11 items-center justify-between gap-3 py-1.5 pr-4 pl-4 shadow-[inset_0_-0.5px_0_var(--separator)]'>
                <span className='text-body'>Parcelas</span>
                <InstallmentStepper value={installments} onChange={setInstallments} />
              </div>
            )}
            {preview && (
              <div className='flex items-center justify-between px-4 py-2.5'>
                <span className='text-subhead text-label-2'>Cada parcela</span>
                <span className='font-rounded numeric text-headline'>{preview}</span>
              </div>
            )}
          </Section>
        ) : (
          transaction?.recurrenceRule && (
            <Section>
              <div className='text-subhead text-label-2 flex items-center gap-2 px-4 py-3'>
                <Repeat className='size-4' />
                {describeRRule(transaction.recurrenceRule)}
              </div>
            </Section>
          )
        )}

        <Section>
          <FieldRow>
            <TextArea
              placeholder='Notas'
              value={notes}
              maxLength={2000}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FieldRow>
        </Section>

        {editing && (
          <Button
            variant='destructive'
            className='w-full'
            disabled={busy}
            onClick={() => (recurring ? setPending({ type: 'delete' }) : void destroy())}
          >
            Apagar Lançamento
          </Button>
        )}
      </Sheet>

      <ActionSheet
        open={pending?.type === 'save'}
        onOpenChange={(value) => !value && setPending(null)}
        title='Este lançamento se repete.'
        actions={[
          { label: 'Salvar só neste', onSelect: () => void save('single') },
          { label: 'Salvar neste e nos próximos', onSelect: () => void save('future') },
        ]}
      />
      <ActionSheet
        open={pending?.type === 'delete'}
        onOpenChange={(value) => !value && setPending(null)}
        title='Este lançamento se repete.'
        actions={[
          { label: 'Apagar só este', destructive: true, onSelect: () => void destroy('single') },
          {
            label: 'Apagar este e os próximos',
            destructive: true,
            onSelect: () => void destroy('future'),
          },
        ]}
      />
    </>
  );
}

function InstallmentStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className='flex items-center gap-3'>
      <span className='font-rounded numeric text-body min-w-[2.5ch] text-right'>{value}×</span>
      <div className='bg-fill flex h-8 items-center rounded-[8px]'>
        <button
          type='button'
          aria-label='Menos parcelas'
          disabled={value <= 2}
          onClick={() => onChange(Math.max(2, value - 1))}
          className='flex h-8 w-11 items-center justify-center active:opacity-40 disabled:opacity-30'
        >
          <Minus className='size-4' strokeWidth={2.5} />
        </button>
        <span className='bg-separator h-4 w-px' />
        <button
          type='button'
          aria-label='Mais parcelas'
          disabled={value >= 72}
          onClick={() => onChange(Math.min(72, value + 1))}
          className='flex h-8 w-11 items-center justify-center active:opacity-40 disabled:opacity-30'
        >
          <Plus className='size-4' strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
