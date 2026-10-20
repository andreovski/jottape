import {
  INVOICE_STATUS_LABELS,
  type InvoiceResponse,
  type InvoiceStatus,
  type TransactionResponse,
} from '@jottape/schemas';
import { Receipt } from 'lucide-react';
import { useState } from 'react';

import { Button, EmptyState, Pill, Skeleton } from '@/components/ios/controls';
import { DateInput, FieldRow, SelectInput } from '@/components/ios/fields';
import { Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import {
  useAccounts,
  useCategories,
  useInvoiceTransactions,
  usePayInvoice,
} from '@/features/finance';
import { longDay, money, monthName, todayKey } from '@/lib/format';
import { useFormErrors } from '@/lib/use-form-errors';

import { invoiceTitle } from './finance-utils';
import { TransactionRow } from './transaction-list';

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  OPEN: 'var(--blue)',
  CLOSED: 'var(--orange)',
  OVERDUE: 'var(--red)',
  PAID: 'var(--green)',
};

export function InvoicePill({ status }: { status: InvoiceStatus }) {
  return <Pill color={INVOICE_STATUS_COLORS[status]}>{INVOICE_STATUS_LABELS[status]}</Pill>;
}

export const invoiceName = (invoice: Pick<InvoiceResponse, 'referenceMonth'>) =>
  invoiceTitle(invoice.referenceMonth, monthName(invoice.referenceMonth), todayKey());

interface InvoiceSheetProps {
  open: boolean;
  /** Continua preenchida depois de fechar, para a folha descer com o conteúdo. */
  invoice: InvoiceResponse | null;
  paymentAccountId: string | null;
  onOpenChange: (open: boolean) => void;
  onSelectTransaction: (transaction: TransactionResponse) => void;
}

/** Fatura: itens e o pagamento. Remonta a cada fatura escolhida. */
export function InvoiceSheet(props: InvoiceSheetProps) {
  return <InvoiceSheetContent key={props.invoice?.id ?? 'none'} {...props} />;
}

function InvoiceSheetContent({
  open,
  invoice,
  paymentAccountId,
  onOpenChange,
  onSelectTransaction,
}: InvoiceSheetProps) {
  const { data: items, isLoading } = useInvoiceTransactions(invoice?.id);
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const pay = usePayInvoice();

  const payers = accounts.filter((a) => a.type !== 'CREDIT_CARD');
  const [fromAccountId, setFromAccountId] = useState(paymentAccountId ?? payers[0]?.id ?? '');
  const [date, setDate] = useState(todayKey());
  const effectiveFrom = fromAccountId || payers[0]?.id || '';

  const payable = invoice && invoice.status !== 'PAID' && invoice.totalCents > 0;
  const { errors, validate } = useFormErrors({
    from: !effectiveFrom && 'Crie uma conta para pagar a fatura.',
  });

  async function submit() {
    if (!invoice || pay.isPending || !validate()) return;
    const ok = await pay.mutateAsync({ id: invoice.id, fromAccountId: effectiveFrom, date }).then(
      () => true,
      () => false
    );
    if (ok) onOpenChange(false);
  }

  return (
    <Sheet
      open={open && Boolean(invoice)}
      onOpenChange={onOpenChange}
      tall
      title={invoice ? invoiceName(invoice) : 'Fatura'}
      cancelLabel='Fechar'
    >
      {invoice && (
        <>
          <div className='flex flex-col items-center pt-2 pb-6 text-center'>
            <InvoicePill status={invoice.status} />
            <div className='font-rounded numeric mt-2 text-[44px] leading-none font-semibold tracking-tight'>
              {money(invoice.totalCents)}
            </div>
            <div className='text-subhead text-label-2 mt-2'>
              Fecha em {longDay(invoice.closingDate)}
              <br />
              Vence em {longDay(invoice.dueDate)}
            </div>
          </div>

          {payable && (
            <Section header='Pagamento'>
              <FieldRow label='Pagar com' error={errors.from}>
                <SelectInput
                  value={effectiveFrom}
                  onChange={setFromAccountId}
                  options={payers.map((a) => ({ value: a.id, label: a.name }))}
                />
              </FieldRow>
              <FieldRow label='Data'>
                <DateInput
                  value={date}
                  onChange={(event) => event.target.value && setDate(event.target.value)}
                />
              </FieldRow>
            </Section>
          )}
          {payable && (
            <Button className='mb-7 w-full' loading={pay.isPending} onClick={() => void submit()}>
              Pagar fatura
            </Button>
          )}

          {isLoading ? (
            <Skeleton className='h-40 w-full' />
          ) : items?.length ? (
            <Section header='Lançamentos'>
              {items.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  transaction={tx}
                  accounts={accounts}
                  categories={categories}
                  showDate
                  onClick={() => onSelectTransaction(tx)}
                />
              ))}
            </Section>
          ) : (
            <EmptyState
              icon={<Receipt />}
              title='Fatura vazia'
              message='Nenhuma compra nesta fatura.'
            />
          )}
        </>
      )}
    </Sheet>
  );
}
