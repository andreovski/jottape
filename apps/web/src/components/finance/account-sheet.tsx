import {
  ACCOUNT_TYPE_LABELS,
  type AccountResponse,
  type AccountType,
  type CreateAccountBody,
} from '@jottape/schemas';
import { useState } from 'react';

import { ColorPicker, FieldRow, MoneyField, SelectInput, TextInput } from '@/components/ios/fields';
import { Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import { useAccounts, useCreateAccount, useUpdateAccount } from '@/features/finance';

import { AccountCard } from './account-card';

const TYPES: AccountType[] = ['CHECKING', 'SAVINGS', 'WALLET', 'CREDIT_CARD'];
const DAYS = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

export interface AccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: AccountResponse;
}

/** Criar ou editar conta. Remonta a cada abertura para começar dos dados atuais. */
export function AccountSheet(props: AccountSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((value) => value + 1);
  }
  return <AccountForm key={`${props.account?.id ?? 'new'}-${session}`} {...props} />;
}

function AccountForm({ open, onOpenChange, account }: AccountSheetProps) {
  const editing = Boolean(account);
  const { data: accounts = [] } = useAccounts();
  const create = useCreateAccount();
  const update = useUpdateAccount();

  const [type, setType] = useState<AccountType>(account?.type ?? 'CHECKING');
  const [name, setName] = useState(account?.name ?? '');
  const [color, setColor] = useState<string | null>(account?.color ?? null);
  const [initial, setInitial] = useState<number | null>(
    account ? account.initialBalanceCents : null
  );
  const [closingDay, setClosingDay] = useState(String(account?.closingDay ?? ''));
  const [dueDay, setDueDay] = useState(String(account?.dueDay ?? ''));
  const [paymentAccountId, setPaymentAccountId] = useState(account?.paymentAccountId ?? '');

  const isCard = type === 'CREDIT_CARD';
  const payers = accounts.filter((a) => a.type !== 'CREDIT_CARD' && a.id !== account?.id);
  const valid = name.trim().length > 0 && (!isCard || (Boolean(closingDay) && Boolean(dueDay)));
  const busy = create.isPending || update.isPending;

  // Prévia ao vivo do cartão, com o que está sendo digitado.
  const preview: AccountResponse = {
    id: account?.id ?? 'preview',
    name: name.trim() || 'Nova conta',
    type,
    color,
    initialBalanceCents: initial ?? 0,
    closingDay: closingDay ? Number(closingDay) : null,
    dueDay: dueDay ? Number(dueDay) : null,
    paymentAccountId: paymentAccountId || null,
    archived: account?.archived ?? false,
    balanceCents: account
      ? account.balanceCents - account.initialBalanceCents + (initial ?? 0)
      : (initial ?? 0),
    expectedBalanceCents: account?.expectedBalanceCents ?? 0,
    openInvoiceCents: account?.openInvoiceCents ?? 0,
  };

  async function save() {
    if (!valid || busy) return;
    const card = {
      closingDay: isCard ? Number(closingDay) : null,
      dueDay: isCard ? Number(dueDay) : null,
      paymentAccountId: isCard ? paymentAccountId || null : null,
    };
    const promise = account
      ? update.mutateAsync({
          id: account.id,
          name: name.trim(),
          color,
          ...(isCard ? {} : { initialBalanceCents: initial ?? 0 }),
          ...card,
        })
      : create.mutateAsync({
          name: name.trim(),
          type,
          color,
          initialBalanceCents: isCard ? 0 : (initial ?? 0),
          ...card,
        } satisfies CreateAccountBody);
    const ok = await promise.then(
      () => true,
      () => false
    );
    if (ok) onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      tall
      title={editing ? 'Editar Conta' : 'Nova Conta'}
      confirmLabel={editing ? 'OK' : 'Adicionar'}
      confirmDisabled={!valid || busy}
      onConfirm={save}
    >
      <div className='mx-auto mt-2 mb-6 w-full max-w-[300px]'>
        <AccountCard account={preview} />
      </div>

      <Section>
        <FieldRow label='Tipo'>
          {editing ? (
            <span className='text-body text-label-2'>{ACCOUNT_TYPE_LABELS[type]}</span>
          ) : (
            <SelectInput
              value={type}
              onChange={(value) => setType(value as AccountType)}
              options={TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABELS[t] }))}
            />
          )}
        </FieldRow>
        <FieldRow>
          <TextInput
            placeholder='Nome'
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
          />
        </FieldRow>
        {!isCard && (
          <FieldRow label='Saldo inicial'>
            <MoneyField value={initial} onChange={setInitial} allowNegative />
          </FieldRow>
        )}
      </Section>

      {isCard && (
        <Section header='Cartão' footer='Compras depois do fechamento entram na fatura seguinte.'>
          <FieldRow label='Dia de fechamento'>
            <SelectInput
              value={closingDay}
              onChange={setClosingDay}
              placeholder='Escolher'
              options={DAYS}
            />
          </FieldRow>
          <FieldRow label='Dia de vencimento'>
            <SelectInput
              value={dueDay}
              onChange={setDueDay}
              placeholder='Escolher'
              options={DAYS}
            />
          </FieldRow>
          <FieldRow label='Conta que paga'>
            <SelectInput
              value={paymentAccountId}
              onChange={setPaymentAccountId}
              placeholder='Nenhuma'
              options={payers.map((a) => ({ value: a.id, label: a.name }))}
            />
          </FieldRow>
        </Section>
      )}

      <Section header='Cor'>
        <ColorPicker value={color} onChange={setColor} />
      </Section>
    </Sheet>
  );
}
