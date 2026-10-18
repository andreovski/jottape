import type { AccountResponse, InvoiceResponse, TransactionResponse } from '@jottape/schemas';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ChevronLeft, CreditCard, Ellipsis, Plus, Receipt, WalletCards } from 'lucide-react';
import { useState } from 'react';

import { AccountCard } from '@/components/finance/account-card';
import { AccountSheet } from '@/components/finance/account-sheet';
import { accountColor, monthOfDay } from '@/components/finance/finance-utils';
import { groupInvoices } from '@/components/finance/finance-utils';
import { invoiceName, InvoicePill, InvoiceSheet } from '@/components/finance/invoice-sheet';
import { TransactionSheet } from '@/components/finance/transaction-sheet';
import { useSheetState } from '@/components/finance/use-sheet-state';
import { Button, EmptyState, Skeleton } from '@/components/ios/controls';
import { IconChip, Row, Section } from '@/components/ios/list';
import { BarButton, Page } from '@/components/ios/page';
import { ActionSheet } from '@/components/ios/sheet';
import { useAccounts, useDeleteAccount, useInvoices, useUpdateAccount } from '@/features/finance';
import { money, shortDay, todayKey } from '@/lib/format';

import { Statement } from './statement';

export function AccountPage() {
  const { accountId } = useParams({ from: '/financas/contas/$accountId' });
  const navigate = useNavigate();
  const { data: accounts, isLoading } = useAccounts({ archived: true });
  const account = accounts?.find((a) => a.id === accountId);

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editSheet = useSheetState<undefined>();
  const txSheet = useSheetState<TransactionResponse>();
  const update = useUpdateAccount();
  const remove = useDeleteAccount();

  const back = () => void navigate({ to: '/financas' });

  const leading = (
    <button
      type='button'
      onClick={back}
      className='text-tint text-body -ml-2 flex items-center active:opacity-40'
    >
      <ChevronLeft className='size-7' strokeWidth={2.25} />
      Finanças
    </button>
  );

  if (isLoading) {
    return (
      <Page title='Conta' leading={leading}>
        <Skeleton className='mx-auto aspect-[1.586] w-full max-w-sm rounded-[16px]' />
      </Page>
    );
  }

  if (!account) {
    return (
      <Page title='Conta' leading={leading}>
        <EmptyState
          icon={<WalletCards />}
          title='Conta não encontrada'
          message='Ela pode ter sido apagada.'
          action={
            <Button size='md' onClick={back}>
              Voltar para Finanças
            </Button>
          }
        />
      </Page>
    );
  }

  const isCard = account.type === 'CREDIT_CARD';

  return (
    <Page
      title={account.name}
      leading={leading}
      actions={
        <>
          <BarButton label='Novo lançamento' onClick={() => txSheet.show(undefined)}>
            <Plus strokeWidth={2.25} />
          </BarButton>
          <BarButton label='Opções' onClick={() => setMenuOpen(true)}>
            <Ellipsis strokeWidth={2.25} />
          </BarButton>
        </>
      }
    >
      <div className='mx-auto mb-6 w-full max-w-sm'>
        <AccountCard account={account} size='lg' />
      </div>

      <AccountFacts account={account} accounts={accounts ?? []} />

      {isCard ? (
        <Invoices account={account} onSelectTransaction={(tx) => txSheet.show(tx)} />
      ) : (
        <AccountStatement
          accountId={account.id}
          onSelect={(tx) => txSheet.show(tx)}
          onCreate={() => txSheet.show(undefined)}
        />
      )}

      <ActionSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title={account.name}
        actions={[
          { label: 'Editar', onSelect: () => editSheet.show(undefined) },
          {
            label: account.archived ? 'Desarquivar' : 'Arquivar',
            onSelect: () => update.mutate({ id: account.id, archived: !account.archived }),
          },
          { label: 'Apagar', destructive: true, onSelect: () => setConfirmDelete(true) },
        ]}
      />
      <ActionSheet
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Apagar “${account.name}”?`}
        message='Só dá para apagar uma conta sem lançamentos. Para guardar o histórico, arquive.'
        actions={[
          {
            label: 'Apagar Conta',
            destructive: true,
            onSelect: () =>
              remove.mutate(account.id, { onSuccess: () => void navigate({ to: '/financas' }) }),
          },
        ]}
      />
      <AccountSheet open={editSheet.open} onOpenChange={editSheet.onOpenChange} account={account} />
      <TransactionSheet
        open={txSheet.open}
        onOpenChange={txSheet.onOpenChange}
        transaction={txSheet.value}
        defaults={{ accountId: account.id }}
      />
    </Page>
  );
}

function AccountFacts({
  account,
  accounts,
}: {
  account: AccountResponse;
  accounts: AccountResponse[];
}) {
  if (account.type === 'CREDIT_CARD') {
    const payer = accounts.find((a) => a.id === account.paymentAccountId);
    return (
      <Section>
        <Row title='Fatura atual' detail={money(account.openInvoiceCents ?? 0)} />
        <Row title='Total em aberto' detail={money(Math.max(0, -account.balanceCents))} />
        <Row title='Fechamento' detail={`Dia ${account.closingDay ?? '—'}`} />
        <Row title='Vencimento' detail={`Dia ${account.dueDay ?? '—'}`} />
        <Row title='Paga com' detail={payer?.name ?? 'Nenhuma'} />
      </Section>
    );
  }
  if (account.expectedBalanceCents === account.balanceCents) return null;
  return (
    <Section footer='Somando os previstos até hoje que ainda não foram marcados como pagos.'>
      <Row
        title='Saldo esperado'
        detail={
          account.expectedBalanceCents < 0
            ? `−${money(-account.expectedBalanceCents)}`
            : money(account.expectedBalanceCents)
        }
      />
    </Section>
  );
}

function AccountStatement({
  accountId,
  onSelect,
  onCreate,
}: {
  accountId: string;
  onSelect: (tx: TransactionResponse) => void;
  onCreate: () => void;
}) {
  const [month, setMonth] = useState(monthOfDay(todayKey()));
  return (
    <Statement
      month={month}
      onMonthChange={setMonth}
      accountId={accountId}
      onSelect={onSelect}
      onCreate={onCreate}
    />
  );
}

function Invoices({
  account,
  onSelectTransaction,
}: {
  account: AccountResponse;
  onSelectTransaction: (tx: TransactionResponse) => void;
}) {
  const { data: invoices, isLoading } = useInvoices(account.id);
  const sheet = useSheetState<InvoiceResponse>();
  // A fatura aberta na folha acompanha os dados novos (ex.: depois de pagar).
  const current = sheet.value
    ? (invoices?.find((i) => i.id === sheet.value?.id) ?? sheet.value)
    : null;

  return (
    <>
      {isLoading ? (
        <Section header='Faturas'>
          <div className='p-4'>
            <Skeleton className='h-32 w-full' />
          </div>
        </Section>
      ) : invoices?.length ? (
        groupInvoices(invoices).map((group) => (
          <Section key={group.title} header={group.title}>
            {group.items.map((invoice) => (
              <Row
                key={invoice.id}
                leading={
                  <IconChip color={accountColor(account)} round>
                    <CreditCard strokeWidth={2.25} />
                  </IconChip>
                }
                title={invoiceName(invoice)}
                subtitle={`Vence em ${shortDay(invoice.dueDate)}`}
                trailing={
                  <span className='flex shrink-0 flex-col items-end gap-0.5'>
                    <span className='font-rounded numeric text-body'>
                      {money(invoice.totalCents)}
                    </span>
                    <InvoicePill status={invoice.status} />
                  </span>
                }
                chevron
                onClick={() => sheet.show(invoice)}
              />
            ))}
          </Section>
        ))
      ) : (
        <Section header='Faturas'>
          <EmptyState
            icon={<Receipt />}
            title='Nenhuma fatura'
            message='As compras no cartão abrem a primeira fatura.'
          />
        </Section>
      )}

      <InvoiceSheet
        open={sheet.open}
        invoice={current}
        paymentAccountId={account.paymentAccountId}
        onOpenChange={sheet.onOpenChange}
        onSelectTransaction={(tx) => {
          sheet.onOpenChange(false);
          onSelectTransaction(tx);
        }}
      />
    </>
  );
}
