import type {
  AssistantIntent,
  AssistantTestCase,
  AssistantTestExpect,
  CreateAssistantTestCaseBody,
} from '@jottape/schemas';
import { useState } from 'react';

import { Button } from '@/components/ios/controls';
import {
  DateInput,
  FieldRow,
  MoneyField,
  SelectInput,
  TextArea,
  TimeInput,
} from '@/components/ios/fields';
import { Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import { useCreateTestCase, useDeleteTestCase, useUpdateTestCase } from '@/features/assistant';

// Caso de teste do Jotta: o pedido e o que o primeiro item precisa ter. Campo vazio não é
// conferido. Vem preenchido com o que o cartão montou; o dono corrige o que estava errado.

export const INTENT_LABEL: Record<AssistantIntent, string> = {
  expense: 'Despesa',
  income: 'Receita',
  transfer: 'Transferência',
  event: 'Evento',
  task: 'Tarefa',
  question: 'Pergunta',
  change: 'Mudança',
  other: 'Outro',
};

export type TestCaseEditing =
  | { mode: 'create'; body: CreateAssistantTestCaseBody }
  | { mode: 'edit'; testCase: AssistantTestCase };

/** Sim / não / não conferir, para campos de verdadeiro ou falso. */
const YES_NO = [
  { value: 'yes', label: 'Sim' },
  { value: 'no', label: 'Não' },
];
const fromBool = (value: boolean | undefined) => (value === undefined ? '' : value ? 'yes' : 'no');
const toBool = (value: string) => (value === '' ? undefined : value === 'yes');

/** Data e horário: '' não confere, 'none' espera vazio (tarefa sem prazo, evento sem hora). */
const fromNullable = (value: string | null | undefined) =>
  value === undefined ? '' : value === null ? 'none' : value;
const toNullable = (value: string) => (value === '' ? undefined : value === 'none' ? null : value);

interface Form {
  text: string;
  intents: AssistantIntent[];
  amountCents: number | null;
  date: string;
  account: string;
  toAccount: string;
  category: string;
  installments: string;
  time: string;
  endTime: string;
  allDay: string;
  list: string;
  notes: string;
}

function formOf(text: string, expect: AssistantTestExpect): Form {
  return {
    text,
    intents: expect.intents,
    amountCents: expect.amountCents ?? null,
    date: fromNullable(expect.date),
    account: expect.account ?? '',
    toAccount: expect.toAccount ?? '',
    category: expect.category ?? '',
    installments: expect.installments ? String(expect.installments) : '',
    time: fromNullable(expect.time),
    endTime: expect.endTime ?? '',
    allDay: fromBool(expect.allDay),
    list: expect.list ?? '',
    notes: fromBool(expect.notes),
  };
}

function expectOf(form: Form): AssistantTestExpect {
  const intent = form.intents[0];
  const finance = intent === 'expense' || intent === 'income' || intent === 'transfer';
  const expect: AssistantTestExpect = { intents: form.intents };
  const set = <K extends keyof AssistantTestExpect>(key: K, value: AssistantTestExpect[K]) => {
    if (value !== undefined && value !== '') expect[key] = value;
  };
  if (finance || intent === 'event' || intent === 'task') set('date', toNullable(form.date));
  if (finance) {
    set('amountCents', form.amountCents ?? undefined);
    set('account', form.account);
    if (intent === 'transfer') set('toAccount', form.toAccount);
    else set('category', form.category);
    if (intent === 'expense' && form.installments) set('installments', Number(form.installments));
  }
  if (intent === 'event') {
    set('allDay', toBool(form.allDay));
    set('time', toNullable(form.time));
    set('endTime', form.endTime);
    set('notes', toBool(form.notes));
  }
  if (intent === 'task') {
    set('time', toNullable(form.time));
    set('list', form.list);
    set('notes', toBool(form.notes));
  }
  return expect;
}

export function TestCaseSheet({
  editing,
  onClose,
}: {
  editing: TestCaseEditing | null;
  onClose: () => void;
}) {
  // Guarda o último aberto para a folha não esvaziar enquanto fecha.
  const [last, setLast] = useState(editing);
  if (editing && editing !== last) setLast(editing);
  const shown = editing ?? last;

  return (
    <Sheet
      open={editing !== null}
      onOpenChange={(open) => !open && onClose()}
      title={shown?.mode === 'edit' ? 'Caso de teste' : 'Novo caso de teste'}
      tall
    >
      {shown && (
        <CaseForm
          key={shown.mode === 'edit' ? shown.testCase.id : `new-${shown.body.feedbackId}`}
          editing={shown}
          onDone={onClose}
        />
      )}
    </Sheet>
  );
}

function CaseForm({ editing, onDone }: { editing: TestCaseEditing; onDone: () => void }) {
  const create = useCreateTestCase();
  const update = useUpdateTestCase();
  const remove = useDeleteTestCase();
  const source = editing.mode === 'edit' ? editing.testCase : editing.body;
  const [form, setForm] = useState(() => formOf(source.text, source.expect));
  const patch = (changes: Partial<Form>) => setForm((f) => ({ ...f, ...changes }));
  const { context } = source;
  const intent = form.intents[0];
  const finance = intent === 'expense' || intent === 'income' || intent === 'transfer';
  const busy = create.isPending || update.isPending || remove.isPending;

  const names = (rows: { name: string }[]) => [
    { value: '', label: 'Não conferir' },
    ...rows.map((r) => ({ value: r.name, label: r.name })),
  ];
  const optional = (options: { value: string; label: string }[]) => [
    { value: '', label: 'Não conferir' },
    ...options,
  ];

  const save = async () => {
    const expect = expectOf(form);
    const text = form.text.trim();
    if (editing.mode === 'edit') {
      await update.mutateAsync({ id: editing.testCase.id, body: { text, expect } });
    } else {
      await create.mutateAsync({ ...editing.body, text, expect });
    }
    onDone();
  };

  return (
    <>
      <Section
        header='Pedido'
        footer={`Roda como se fosse ${source.today.split('-').reverse().join('/')}, com as contas, categorias e listas da pessoa naquele dia.`}
      >
        <FieldRow>
          <TextArea
            aria-label='Pedido'
            value={form.text}
            onChange={(event) => patch({ text: event.target.value })}
          />
        </FieldRow>
      </Section>

      <Section
        header='Resposta certa'
        footer='Vale para o primeiro item do pedido. Campo em “Não conferir” fica de fora.'
      >
        <FieldRow label={form.intents.length > 1 ? `Tipo (de ${form.intents.length})` : 'Tipo'}>
          <SelectInput
            value={intent}
            onChange={(value) =>
              patch({ intents: [value as AssistantIntent, ...form.intents.slice(1)] })
            }
            options={Object.entries(INTENT_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </FieldRow>
        {(finance || intent === 'event' || intent === 'task') && (
          <FieldRow label='Data'>
            <SelectInput
              value={form.date === '' || form.date === 'none' ? form.date : 'day'}
              onChange={(value) =>
                patch({ date: value === 'day' ? form.date || source.today : value })
              }
              options={optional([
                { value: 'day', label: 'Dia' },
                ...(intent === 'task' ? [{ value: 'none', label: 'Sem prazo' }] : []),
              ])}
            />
            {form.date !== '' && form.date !== 'none' && (
              <span className='ml-2'>
                <DateInput
                  value={form.date}
                  onChange={(event) => patch({ date: event.target.value })}
                />
              </span>
            )}
          </FieldRow>
        )}
        {finance && (
          <>
            <FieldRow label='Valor'>
              <MoneyField
                value={form.amountCents}
                onChange={(amountCents) => patch({ amountCents })}
                placeholder='Não conferir'
              />
            </FieldRow>
            <FieldRow label={intent === 'transfer' ? 'De' : 'Conta'}>
              <SelectInput
                value={form.account}
                onChange={(account) => patch({ account })}
                options={names(context.accounts)}
              />
            </FieldRow>
            {intent === 'transfer' ? (
              <FieldRow label='Para'>
                <SelectInput
                  value={form.toAccount}
                  onChange={(toAccount) => patch({ toAccount })}
                  options={names(context.accounts)}
                />
              </FieldRow>
            ) : (
              <FieldRow label='Categoria'>
                <SelectInput
                  value={form.category}
                  onChange={(category) => patch({ category })}
                  options={names(
                    context.categories.filter(
                      (c) => c.kind === (intent === 'income' ? 'INCOME' : 'EXPENSE')
                    )
                  )}
                />
              </FieldRow>
            )}
            {intent === 'expense' && (
              <FieldRow label='Parcelas'>
                <SelectInput
                  value={form.installments}
                  onChange={(installments) => patch({ installments })}
                  options={optional(
                    Array.from({ length: 23 }, (_, i) => ({
                      value: String(i + 2),
                      label: `${i + 2}x`,
                    }))
                  )}
                />
              </FieldRow>
            )}
          </>
        )}
        {intent === 'event' && (
          <FieldRow label='Dia inteiro'>
            <SelectInput
              value={form.allDay}
              onChange={(allDay) => patch({ allDay })}
              options={optional(YES_NO)}
            />
          </FieldRow>
        )}
        {(intent === 'event' || intent === 'task') && (
          <>
            <FieldRow label={intent === 'task' ? 'Horário' : 'Início'}>
              <SelectInput
                value={form.time === '' || form.time === 'none' ? form.time : 'at'}
                onChange={(value) => patch({ time: value === 'at' ? form.time || '09:00' : value })}
                options={optional([
                  { value: 'at', label: 'Às' },
                  { value: 'none', label: 'Sem horário' },
                ])}
              />
              {form.time !== '' && form.time !== 'none' && (
                <span className='ml-2'>
                  <TimeInput
                    value={form.time}
                    onChange={(event) => patch({ time: event.target.value })}
                  />
                </span>
              )}
            </FieldRow>
            {intent === 'event' && (
              <FieldRow label='Fim'>
                <SelectInput
                  value={form.endTime === '' ? '' : 'at'}
                  onChange={(value) =>
                    patch({ endTime: value === 'at' ? form.endTime || '10:00' : '' })
                  }
                  options={optional([{ value: 'at', label: 'Às' }])}
                />
                {form.endTime !== '' && (
                  <span className='ml-2'>
                    <TimeInput
                      value={form.endTime}
                      onChange={(event) => patch({ endTime: event.target.value })}
                    />
                  </span>
                )}
              </FieldRow>
            )}
            {intent === 'task' && (
              <FieldRow label='Lista'>
                <SelectInput
                  value={form.list}
                  onChange={(list) => patch({ list })}
                  options={names(context.lists)}
                />
              </FieldRow>
            )}
            <FieldRow label='Com notas'>
              <SelectInput
                value={form.notes}
                onChange={(notes) => patch({ notes })}
                options={optional(YES_NO)}
              />
            </FieldRow>
          </>
        )}
      </Section>

      <div className='flex flex-col gap-2'>
        <Button
          size='md'
          className='w-full'
          disabled={busy || !form.text.trim()}
          loading={create.isPending || update.isPending}
          onClick={save}
        >
          {editing.mode === 'edit' ? 'Salvar' : 'Criar o caso'}
        </Button>
        {editing.mode === 'edit' && (
          <Button
            variant='gray'
            size='md'
            className='text-red w-full'
            disabled={busy}
            loading={remove.isPending}
            onClick={async () => {
              await remove.mutateAsync(editing.testCase.id);
              onDone();
            }}
          >
            Apagar o caso
          </Button>
        )}
      </div>
    </>
  );
}
