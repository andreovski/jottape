import type { BankCardCheckResponse } from '@jottape/schemas';

import { Skeleton } from '@/components/ios/controls';
import { Row, Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import { useBankCardCheck } from '@/features/bank';
import { money, shortDay } from '@/lib/format';

import { InvoicePill } from './invoice-sheet';

// O cartão ligado como o banco vê, ao lado do Jottape: o limite usado contra o que está em aberto
// aqui, e cada fatura fechada no banco (valor e pagamento) contra a fatura do mesmo vencimento.

type Bill = BankCardCheckResponse['bills'][number];

function bankLine(bill: Bill) {
  const total = `Banco ${money(bill.bankTotalCents)}`;
  if (bill.bankPaidCents >= bill.bankTotalCents && bill.bankPaidCents > 0) {
    return `${total} · paga${bill.bankPaidOn ? ` em ${shortDay(bill.bankPaidOn)}` : ''}`;
  }
  if (bill.bankPaidCents > 0) return `${total} · pagou ${money(bill.bankPaidCents)}`;
  return `${total} · sem pagamento informado`;
}

export function BankCheckSheet({
  accountId,
  open,
  onOpenChange,
}: {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const check = useBankCardCheck(accountId, open);
  const data = check.data;
  const diff = data ? data.usedCents - data.openCents : 0;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title='Conferir com o banco'
      cancelLabel='OK'
      tall
    >
      {check.isError && (
        <p className='text-body text-label-2 px-4'>
          Não deu para ler o banco agora. Tente de novo em alguns minutos.
        </p>
      )}
      {!data && !check.isError && <Skeleton className='h-60 w-full rounded-[var(--radius)]' />}
      {data && (
        <>
          <Section footer='O banco soma a fatura aberta, as fechadas ainda sem pagar e as parcelas que vão cair. O Jottape soma as faturas que não estão pagas.'>
            <Row title={`Usado no ${data.bankName}`} detail={money(data.usedCents)} />
            <Row title='Em aberto no Jottape' detail={money(data.openCents)} />
            {diff !== 0 && (
              <Row
                title='Diferença'
                detail={`${money(Math.abs(diff))} ${diff > 0 ? 'a menos aqui' : 'a mais aqui'}`}
              />
            )}
          </Section>

          <Section
            header='Faturas fechadas no banco'
            footer={`${data.movements.withBill} de ${data.movements.total} lançamentos do cartão já vieram com a fatura do banco; os outros entram pela data.`}
          >
            {data.bills.length === 0 && <Row title='O banco não informou faturas fechadas' />}
            {data.bills.map((bill) => (
              <Row
                key={bill.dueDate}
                title={`Vence em ${shortDay(bill.dueDate)}`}
                subtitle={bankLine(bill)}
                wrapSubtitle
                trailing={
                  bill.invoice ? (
                    <span className='flex shrink-0 flex-col items-end gap-0.5'>
                      <span className='font-rounded numeric text-body'>
                        {money(bill.invoice.totalCents)}
                      </span>
                      <InvoicePill status={bill.invoice.status} />
                    </span>
                  ) : (
                    <span className='text-footnote text-label-2'>Sem fatura aqui</span>
                  )
                }
              />
            ))}
          </Section>
        </>
      )}
    </Sheet>
  );
}
