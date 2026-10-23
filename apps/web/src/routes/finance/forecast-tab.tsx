import { addDays } from '@jottape/finance-engine';
import type { AccountResponse, ForecastResponse, TransactionResponse } from '@jottape/schemas';
import { useNavigate } from '@tanstack/react-router';
import { CalendarClock, CreditCard, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from 'recharts';

import {
  accountColor,
  axisTicks,
  compactMoney,
  futureInvoiceIds,
  zeroCrossingOffset,
} from '@/components/finance/finance-utils';
import { InvoicePill } from '@/components/finance/invoice-sheet';
import { TransactionRow } from '@/components/finance/transaction-list';
import { useUnpaidCardInvoices } from '@/components/finance/use-card-invoices';
import { EmptyState, Segmented, Skeleton } from '@/components/ios/controls';
import { IconChip, Row, Section } from '@/components/ios/list';
import { useAccounts, useCategories, useForecast, useTransactions } from '@/features/finance';
import { longDay, money, shortDay, todayKey } from '@/lib/format';
import { cn } from '@/lib/utils';

type Horizon = '30' | '90' | '365';

export function ForecastTab({ onSelect }: { onSelect: (tx: TransactionResponse) => void }) {
  const [horizon, setHorizon] = useState<Horizon>('30');
  const days = Number(horizon) as 30 | 90 | 365;
  const { data: forecast, isLoading } = useForecast(days);
  const { data: accounts = [] } = useAccounts();

  return (
    <div>
      <Segmented
        value={horizon}
        onChange={setHorizon}
        size='sm'
        className='mx-auto mb-4 max-w-xs'
        options={[
          { value: '30', label: '30 dias' },
          { value: '90', label: '90 dias' },
          { value: '365', label: '365 dias' },
        ]}
      />

      {forecast?.firstNegative && (
        <NegativeAlert firstNegative={forecast.firstNegative} accounts={accounts} />
      )}

      <Section>
        {isLoading || !forecast ? (
          <div className='p-4'>
            <Skeleton className='mb-2 h-4 w-32' />
            <Skeleton className='h-56 w-full' />
          </div>
        ) : (
          <ForecastChart forecast={forecast} />
        )}
      </Section>

      <UpcomingTransactions onSelect={onSelect} />
      <UnpaidInvoices accounts={accounts} />
    </div>
  );
}

function NegativeAlert({
  firstNegative,
  accounts,
}: {
  firstNegative: NonNullable<ForecastResponse['firstNegative']>;
  accounts: AccountResponse[];
}) {
  const account = accounts.find((a) => a.id === firstNegative.accountId);
  return (
    <div className='bg-red/12 mb-5 flex gap-3 rounded-[var(--radius)] p-4'>
      <span className='bg-red flex size-8 shrink-0 items-center justify-center rounded-full text-white'>
        <TriangleAlert className='size-[18px]' strokeWidth={2.25} />
      </span>
      <div className='min-w-0'>
        <div className='text-headline'>
          Seu saldo fica negativo em {shortDay(firstNegative.date)}
        </div>
        <div className='text-subhead text-label-2'>
          {account ? account.name : 'Saldo total'}:{' '}
          <span className='font-rounded numeric text-red font-semibold'>
            −{money(Math.abs(Math.round(firstNegative.balanceCents)))}
          </span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ gráfico

interface Point {
  date: string;
  value: number;
}

function ForecastChart({ forecast }: { forecast: ForecastResponse }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const data: Point[] = forecast.days.map((d) => ({ date: d.date, value: d.totalCents }));
  const values = data.map((d) => d.value);
  const offset = zeroCrossingOffset(values);
  const ticks = axisTicks(
    data.map((d) => d.date),
    4
  );
  const last = data.at(-1);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  // Linha reta (saldo parado) tem caixa de altura zero e o gradiente some: usa cor sólida.
  const flat = Math.min(...values) === Math.max(...values);
  const flatColor = (values[0] ?? 0) < 0 ? 'var(--red)' : 'var(--green)';

  return (
    <div className='pt-4 pb-2'>
      <div className='px-4'>
        <div className='text-footnote text-label-2 font-medium uppercase'>Saldo previsto</div>
        {last && (
          <div className='flex items-baseline gap-2'>
            <span
              className={cn(
                'font-rounded numeric text-title-1',
                last.value < 0 ? 'text-red' : undefined
              )}
            >
              {last.value < 0 ? `−${money(-last.value)}` : money(last.value)}
            </span>
            <span className='text-footnote text-label-2'>em {shortDay(last.date)}</span>
          </div>
        )}
      </div>
      <div className='mt-2 h-60 w-full sm:h-72'>
        <ResponsiveContainer width='100%' height='100%'>
          <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 12 }}>
            <defs>
              <linearGradient id={`fill${id}`} x1='0' y1='0' x2='0' y2='1'>
                <stop offset={0} stopColor='var(--green)' stopOpacity={0.38} />
                <stop offset={offset} stopColor='var(--green)' stopOpacity={0.04} />
                <stop offset={offset} stopColor='var(--red)' stopOpacity={0.04} />
                <stop offset={1} stopColor='var(--red)' stopOpacity={0.38} />
              </linearGradient>
              <linearGradient id={`line${id}`} x1='0' y1='0' x2='0' y2='1'>
                <stop offset={0} stopColor='var(--green)' />
                <stop offset={offset} stopColor='var(--green)' />
                <stop offset={offset} stopColor='var(--red)' />
                <stop offset={1} stopColor='var(--red)' />
              </linearGradient>
            </defs>
            <XAxis
              dataKey='date'
              ticks={ticks}
              tickFormatter={(value: string) => shortDay(value).replace(' de ', ' ')}
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={{ fill: 'var(--label-2)', fontSize: 11 }}
              tickMargin={8}
            />
            <YAxis
              orientation='right'
              domain={[min, max]}
              tickCount={4}
              tickFormatter={(value: number) => compactMoney(value)}
              tickLine={false}
              axisLine={false}
              width={48}
              tick={{ fill: 'var(--label-2)', fontSize: 11 }}
            />
            <ReferenceLine y={0} stroke='var(--label-3)' strokeDasharray='4 4' />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: 'var(--label-3)', strokeWidth: 1 }}
              isAnimationActive={false}
            />
            <Area
              type='monotone'
              dataKey='value'
              stroke={flat ? flatColor : `url(#line${id})`}
              strokeWidth={2}
              fill={`url(#fill${id})`}
              baseValue={0}
              activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)', fill: 'var(--tint)' }}
              animationDuration={500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as Point;
  return (
    <div className='material rounded-[12px] px-3 py-2 shadow-[0_6px_20px_rgb(0_0_0/0.15)]'>
      <div className='text-caption text-label-2'>{longDay(point.date)}</div>
      <div
        className={cn(
          'font-rounded numeric text-headline',
          point.value < 0 ? 'text-red' : undefined
        )}
      >
        {point.value < 0 ? `−${money(-point.value)}` : money(point.value)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ listas

function UpcomingTransactions({ onSelect }: { onSelect: (tx: TransactionResponse) => void }) {
  const today = todayKey();
  const { data, isLoading } = useTransactions({
    from: today,
    to: addDays(today, 30),
    status: 'PLANNED',
  });
  const { data: accounts = [] } = useAccounts({ archived: true });
  const { data: categories = [] } = useCategories();
  const upcoming = [...(data ?? [])].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );

  return (
    <Section header='Próximos lançamentos' footer='Previstos dos próximos 30 dias.'>
      {isLoading ? (
        <div className='p-4'>
          <Skeleton className='h-24 w-full' />
        </div>
      ) : upcoming.length ? (
        upcoming.map((tx) => (
          <TransactionRow
            key={tx.id}
            transaction={tx}
            accounts={accounts}
            categories={categories}
            showDate
            onClick={() => onSelect(tx)}
          />
        ))
      ) : (
        <EmptyState
          icon={<CalendarClock />}
          title='Nada previsto'
          message='Nenhum lançamento nos próximos 30 dias.'
        />
      )}
    </Section>
  );
}

function UnpaidInvoices({ accounts }: { accounts: AccountResponse[] }) {
  const navigate = useNavigate();
  const { invoices } = useUnpaidCardInvoices(accounts);
  if (!invoices.length) return null;
  const future = futureInvoiceIds(invoices.map((i) => i.invoice));

  return (
    <Section header='Faturas a pagar'>
      {invoices.map(({ account, invoice }) => (
        <Row
          key={invoice.id}
          leading={
            <IconChip color={accountColor(account)} round>
              <CreditCard strokeWidth={2.25} />
            </IconChip>
          }
          title={account.name}
          subtitle={`Vence em ${shortDay(invoice.dueDate)}`}
          trailing={
            <span className='flex shrink-0 flex-col items-end gap-0.5'>
              <span className='font-rounded numeric text-body'>{money(invoice.totalCents)}</span>
              <InvoicePill status={invoice.status} future={future.has(invoice.id)} />
            </span>
          }
          chevron
          onClick={() =>
            void navigate({ to: '/financas/contas/$accountId', params: { accountId: account.id } })
          }
        />
      ))}
    </Section>
  );
}
