import { addDays } from '@jottape/finance-engine';
import type { AccountResponse, BankAccountResponse, BankItemResponse } from '@jottape/schemas';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ChevronLeft,
  CreditCard,
  Hash,
  Inbox,
  KeyRound,
  Landmark,
  Plus,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button, Spinner } from '@/components/ios/controls';
import { DateInput, FieldRow, SelectInput, TextInput } from '@/components/ios/fields';
import { IconChip, Row, Section } from '@/components/ios/list';
import { BarButton, Page } from '@/components/ios/page';
import { ActionSheet, Sheet } from '@/components/ios/sheet';
import {
  openPluggyConnect,
  PLUGGY_LINKS,
  useAddBankItem,
  useBankStatus,
  useLinkBankAccount,
  useRemoveBankCredentials,
  useRemoveBankItem,
  useSaveBankCredentials,
  useSyncBank,
} from '@/features/bank';
import { useAccounts } from '@/features/finance';
import { errorMessage } from '@/lib/api';
import { money, todayKey } from '@/lib/format';
import { useFormErrors } from '@/lib/use-form-errors';

/** Dias para trás que a primeira importação traz (igual ao padrão da API). */
const DEFAULT_IMPORT_DAYS = 30;

function ago(iso: string | null) {
  if (!iso) return 'nunca';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function BankPage() {
  const navigate = useNavigate();
  const status = useBankStatus();
  const sync = useSyncBank();
  const data = status.data;

  const back = (
    <button
      type='button'
      onClick={() => navigate({ to: '/ajustes' })}
      className='text-tint text-body -ml-2 flex items-center active:opacity-40'
    >
      <ChevronLeft className='size-7' strokeWidth={2.2} />
      Ajustes
    </button>
  );

  return (
    <Page
      title='Bancos'
      leading={back}
      actions={
        data?.items.length ? (
          <BarButton
            label='Sincronizar agora'
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            {sync.isPending ? <Spinner /> : <RefreshCw />}
          </BarButton>
        ) : null
      }
    >
      {!data ? (
        <div className='text-label-2 flex justify-center py-16'>
          <Spinner />
        </div>
      ) : !data.configured ? (
        <Setup />
      ) : (
        <Connected />
      )}
    </Page>
  );
}

// ---------------------------------------------------------------- configurar

const STEPS = [
  {
    title: 'Vincule os bancos no Meu Pluggy',
    text: (
      <>
        Crie sua conta em <ExternalLink href={PLUGGY_LINKS.meuPluggy}>meu.pluggy.ai</ExternalLink> e
        conecte seus bancos pelo Open Finance. É de graça para as suas próprias contas, até 5
        bancos.
      </>
    ),
  },
  {
    title: 'Crie uma aplicação na Pluggy',
    text: (
      <>
        Em <ExternalLink href={PLUGGY_LINKS.dashboard}>dashboard.pluggy.ai</ExternalLink>, crie a
        conta de desenvolvedor e uma aplicação. Em Dados Financeiros › Customização, deixe o
        conector <b>MeuPluggy</b> na lista. O aviso de teste de 15 dias não vale para o Meu Pluggy,
        que continua grátis.
      </>
    ),
  },
  {
    title: 'Copie as chaves',
    text: 'Na página da aplicação, copie o Client ID e o Client Secret e cole aqui embaixo.',
  },
  {
    title: 'Conecte um banco por vez',
    text: 'Toque em Conectar banco, entre com o Meu Pluggy e autorize as contas de um banco. Repita para cada banco, e escolha em que conta do Jottape cada conta entra.',
  },
];

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target='_blank' rel='noreferrer' className='text-tint'>
      {children}
    </a>
  );
}

function Setup() {
  return (
    <>
      <div className='bg-surface mb-7 flex flex-col items-center rounded-[var(--radius)] px-6 py-8 text-center'>
        <span className='bg-green/15 text-green mb-4 flex size-16 items-center justify-center rounded-[18px]'>
          <Landmark className='size-8' />
        </span>
        <h2 className='text-title-2'>Seus bancos no Jottape</h2>
        <p className='text-subhead text-label-2 mt-2 max-w-sm'>
          Os lançamentos das suas contas e cartões chegam sozinhos, pelo Open Finance. O que você já
          lançou não se repete, e o resto espera sua revisão antes de entrar no saldo.
        </p>
      </div>

      <Section header='Passo a passo'>
        {STEPS.map((step, index) => (
          <Row
            key={step.title}
            leading={
              <span className='bg-tint font-rounded flex size-[29px] items-center justify-center rounded-full text-[15px] font-semibold text-white'>
                {index + 1}
              </span>
            }
            title={step.title}
            subtitle={step.text}
            wrapSubtitle
          />
        ))}
      </Section>

      <KeysForm />
    </>
  );
}

function KeysForm({ onSaved }: { onSaved?: () => void }) {
  const save = useSaveBankCredentials();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const { errors, validate } = useFormErrors({
    clientId: !clientId.trim() && 'Cole o Client ID.',
    clientSecret: !clientSecret.trim() && 'Cole o Client Secret.',
  });

  async function submit() {
    if (!validate()) return;
    await save.mutateAsync({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    toast.success('Chaves salvas. Agora conecte um banco.');
    setClientSecret('');
    onSaved?.();
  }

  return (
    <>
      <Section
        header='Chaves da Pluggy'
        footer='O Client Secret fica cifrado no servidor e não volta para o app. Cada pessoa usa as próprias chaves: os dados vão da Pluggy direto para a sua conta do Jottape.'
      >
        <FieldRow label='Client ID' error={errors.clientId}>
          <TextInput
            align='right'
            autoComplete='off'
            autoCapitalize='off'
            spellCheck={false}
            placeholder='colar'
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </FieldRow>
        <FieldRow label='Client Secret' error={errors.clientSecret}>
          <TextInput
            type='password'
            align='right'
            autoComplete='off'
            placeholder='colar'
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
        </FieldRow>
      </Section>
      <Button className='mb-7 w-full' loading={save.isPending} onClick={submit}>
        Salvar chaves
      </Button>
    </>
  );
}

// ---------------------------------------------------------------- conectado

function Connected() {
  const data = useBankStatus().data!;
  const accounts = useAccounts().data ?? [];
  const add = useAddBankItem();
  const remove = useRemoveBankCredentials();
  const removeItem = useRemoveBankItem();
  const { resolvedTheme } = useTheme();
  const [connecting, setConnecting] = useState(false);
  const [linking, setLinking] = useState<BankAccountResponse | null>(null);
  const [sheet, setSheet] = useState<'item' | 'keys' | 'remove' | null>(null);
  const [removingItem, setRemovingItem] = useState<BankItemResponse | null>(null);

  async function connect() {
    setConnecting(true);
    try {
      const itemId = await openPluggyConnect(resolvedTheme === 'dark' ? 'dark' : 'light');
      if (itemId) {
        await add.mutateAsync(itemId);
        toast.success('Banco conectado. Agora escolha onde cada conta entra.');
      }
    } catch (error) {
      toast.error(
        error instanceof Error && !('response' in error) ? error.message : await errorMessage(error)
      );
    } finally {
      setConnecting(false);
    }
  }

  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name;

  return (
    <>
      {data.lastError && (
        <Section>
          <Row
            leading={
              <IconChip color='var(--orange)'>
                <TriangleAlert />
              </IconChip>
            }
            title='A última sincronização falhou'
            subtitle={data.lastError}
            wrapSubtitle
          />
        </Section>
      )}

      {data.pendingCount > 0 && (
        <Section>
          <Link to='/financas/revisar' className='block'>
            <Row
              chevron
              leading={
                <IconChip color='var(--green)'>
                  <Inbox />
                </IconChip>
              }
              title='A revisar'
              detail={data.pendingCount}
            />
          </Link>
        </Section>
      )}

      {data.items.map((item) => (
        <Section
          key={item.id}
          header={item.name}
          footer={
            item.lastError ??
            `Atualizado ${ago(item.syncedAt)}. O Meu Pluggy lê o banco uma vez por dia.`
          }
        >
          {item.accounts.map((account) => (
            <Row
              key={account.id}
              chevron
              onClick={() => setLinking(account)}
              leading={
                <IconChip color={account.type === 'CREDIT' ? 'var(--orange)' : 'var(--green)'}>
                  {account.type === 'CREDIT' ? <CreditCard /> : <Landmark />}
                </IconChip>
              }
              title={account.name}
              subtitle={[
                `${account.type === 'CREDIT' ? 'Fatura' : 'Saldo'} ${money(account.balanceCents)}`,
                account.number,
              ]
                .filter(Boolean)
                .join(' · ')}
              detail={accountName(account.accountId) ?? 'Não importar'}
            />
          ))}
          {item.accounts.length === 0 && (
            <Row
              title='Nenhuma conta neste banco ainda'
              subtitle='Sincronize de novo mais tarde.'
            />
          )}
          <Row destructive title='Remover banco' onClick={() => setRemovingItem(item)} />
        </Section>
      ))}

      <Section
        footer={
          data.items.length
            ? 'Para trazer outro banco, vincule ele no meu.pluggy.ai e toque em Conectar outro banco. Cada banco do Meu Pluggy é uma conexão.'
            : 'Cada banco é conectado uma vez pelo Meu Pluggy. Os lançamentos chegam a cada poucas horas.'
        }
      >
        <Row
          action
          onClick={connect}
          disabled={connecting}
          title={
            <span className='flex items-center gap-2'>
              {connecting ? <Spinner /> : <Plus className='size-5' />}{' '}
              {data.items.length ? 'Conectar outro banco' : 'Conectar banco'}
            </span>
          }
        />
        <Row
          onClick={() => setSheet('item')}
          leading={
            <IconChip color='var(--gray)'>
              <Hash />
            </IconChip>
          }
          title='Adicionar pelo ID do item'
          subtitle='Se o banco já aparece no painel da Pluggy'
        />
      </Section>

      <Section>
        <Row
          onClick={() => setSheet('keys')}
          chevron
          leading={
            <IconChip color='var(--gray)'>
              <KeyRound />
            </IconChip>
          }
          title='Chaves da Pluggy'
          detail={<span className='font-mono text-[13px]'>{data.clientId?.slice(0, 8)}…</span>}
        />
        <Row destructive title='Desconectar a Pluggy' onClick={() => setSheet('remove')} />
      </Section>

      {linking && (
        <LinkSheet
          account={linking}
          accounts={accounts}
          linkedIds={data.items
            .flatMap((i) => i.accounts)
            .filter((a) => a.id !== linking.id)
            .map((a) => a.accountId)}
          onClose={() => setLinking(null)}
        />
      )}
      <ItemSheet open={sheet === 'item'} onOpenChange={(open) => setSheet(open ? 'item' : null)} />
      <Sheet
        open={sheet === 'keys'}
        onOpenChange={(open) => setSheet(open ? 'keys' : null)}
        title='Chaves da Pluggy'
      >
        <KeysForm onSaved={() => setSheet(null)} />
      </Sheet>
      <ActionSheet
        open={sheet === 'remove'}
        onOpenChange={(open) => setSheet(open ? 'remove' : null)}
        title='Desconectar a Pluggy?'
        message='As chaves e os bancos saem do Jottape. Os lançamentos já importados continuam.'
        actions={[{ label: 'Desconectar', destructive: true, onSelect: () => remove.mutate() }]}
      />
      <ActionSheet
        open={Boolean(removingItem)}
        onOpenChange={(open) => !open && setRemovingItem(null)}
        title={`Remover ${removingItem?.name ?? 'banco'}?`}
        message='Ele para de trazer lançamentos. Os já importados continuam. Para conectar de novo, use Conectar banco.'
        actions={[
          {
            label: 'Remover banco',
            destructive: true,
            onSelect: () => removingItem && removeItem.mutate(removingItem.id),
          },
        ]}
      />
    </>
  );
}

const NEW = 'new';

function LinkSheet({
  account,
  accounts,
  linkedIds,
  onClose,
}: {
  account: BankAccountResponse;
  accounts: AccountResponse[];
  /** Contas do Jottape já ligadas a outras contas do banco. */
  linkedIds: (string | null)[];
  onClose: () => void;
}) {
  const link = useLinkBankAccount();
  const isCard = account.type === 'CREDIT';
  const [target, setTarget] = useState(account.accountId ?? '');
  const [importFrom, setImportFrom] = useState(
    account.importFrom ?? addDays(todayKey(), -DEFAULT_IMPORT_DAYS)
  );

  const options = [
    { value: NEW, label: isCard ? 'Criar cartão novo' : 'Criar conta nova' },
    ...accounts
      .filter((a) => (isCard ? a.type === 'CREDIT_CARD' : a.type !== 'CREDIT_CARD'))
      .filter((a) => !linkedIds.includes(a.id))
      .map((a) => ({ value: a.id, label: a.name })),
  ];
  const unchanged = target === (account.accountId ?? '') && importFrom === account.importFrom;

  async function confirm() {
    if (unchanged) return onClose();
    const status = await link.mutateAsync({
      id: account.id,
      body:
        target === ''
          ? { accountId: null }
          : target === NEW
            ? { create: true, importFrom }
            : { accountId: target, importFrom },
    });
    const pending = status.pendingCount;
    if (target) {
      toast.success(
        pending ? `Pronto. ${pending} lançamento(s) esperando revisão em Finanças.` : 'Pronto.'
      );
    }
    onClose();
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={account.name}
      confirmLabel='OK'
      confirmDisabled={link.isPending}
      onConfirm={confirm}
    >
      <Section
        footer={
          target === NEW
            ? isCard
              ? 'O cartão nasce com o fechamento e o vencimento que o banco informa.'
              : 'A conta nasce com um saldo inicial que, depois da revisão, deixa o saldo igual ao do banco.'
            : 'O que você já lançou (mesmo valor, até 4 dias de diferença) não se repete. O resto aparece em A revisar.'
        }
      >
        <FieldRow label='Entra em'>
          <SelectInput
            value={target}
            onChange={setTarget}
            options={options}
            placeholder='Não importar'
          />
        </FieldRow>
        {target !== '' && (
          <FieldRow label='Importar desde'>
            <DateInput
              value={importFrom}
              max={todayKey()}
              onChange={(e) => e.target.value && setImportFrom(e.target.value)}
            />
          </FieldRow>
        )}
      </Section>
      {link.isPending && (
        <p className='text-footnote text-label-2 flex items-center justify-center gap-2'>
          <Spinner /> Lendo os lançamentos do banco…
        </p>
      )}
    </Sheet>
  );
}

function ItemSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const add = useAddBankItem();
  const [itemId, setItemId] = useState('');
  const { errors, validate } = useFormErrors({
    itemId: !/^[0-9a-f-]{36}$/i.test(itemId.trim()) && 'Cole o ID do item (um código com hífens).',
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title='ID do Item'
      confirmLabel='Adicionar'
      confirmDisabled={add.isPending}
      onConfirm={async () => {
        if (!validate()) return;
        await add.mutateAsync(itemId.trim());
        toast.success('Banco adicionado.');
        setItemId('');
        onOpenChange(false);
      }}
    >
      <Section footer='No painel da Pluggy, depois de conectar o banco pelo MeuPluggy, o item aparece com um ID. Use isto se o botão Conectar banco não abrir.'>
        <FieldRow error={errors.itemId}>
          <TextInput
            autoComplete='off'
            autoCapitalize='off'
            spellCheck={false}
            placeholder='1a2b3c4d-…'
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
          />
        </FieldRow>
      </Section>
    </Sheet>
  );
}
