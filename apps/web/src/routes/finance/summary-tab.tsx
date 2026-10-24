import { ArrowDownLeft, ArrowUpRight, ChartPie, Clock } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipProps } from 'recharts';

import { CategoryIcon } from '@/components/finance/category-icon';
import {
  categorySlices,
  comparisonText,
  percentLabel,
  type Slice,
} from '@/components/finance/finance-utils';
import { MonthSwitcher } from '@/components/finance/month-switcher';
import { EmptyState, Skeleton } from '@/components/ios/controls';
import { FitText } from '@/components/ios/fit-text';
import { Row, Section } from '@/components/ios/list';
import { useCategories, useMonthSummary } from '@/features/finance';
import { amountTone, money, monthName } from '@/lib/format';
import { cn } from '@/lib/utils';

export function SummaryTab({
  month,
  onMonthChange,
}: {
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const { data: summary, isLoading } = useMonthSummary(month);
  const { data: categories = [] } = useCategories();

  return (
    <div>
      <MonthSwitcher month={month} onChange={onMonthChange} className='-mx-2 mb-4' />

      {isLoading || !summary ? (
        <div className='space-y-3'>
          <div className='grid grid-cols-2 gap-3'>
            <Skeleton className='h-28' />
            <Skeleton className='h-28' />
          </div>
          <Skeleton className='h-80' />
        </div>
      ) : (
        <SummaryContent
          summary={summary}
          slices={categorySlices(summary.expenseByCategory, categories)}
        />
      )}
    </div>
  );
}

function SummaryContent({
  summary,
  slices,
}: {
  summary: NonNullable<ReturnType<typeof useMonthSummary>['data']>;
  slices: Slice[];
}) {
  const previousName = monthName(summary.previous.month);
  const hasPlanned = summary.plannedIncomeCents > 0 || summary.plannedExpenseCents > 0;

  return (
    <>
      <div className='mb-3 grid grid-cols-2 gap-3'>
        <BigTile
          label='Entradas'
          icon={<ArrowDownLeft strokeWidth={2.5} />}
          color='var(--green)'
          value={summary.incomeCents}
          comparison={comparisonText(
            summary.incomeCents,
            summary.previous.incomeCents,
            previousName
          )}
        />
        <BigTile
          label='Saídas'
          icon={<ArrowUpRight strokeWidth={2.5} />}
          color='var(--red)'
          value={summary.expenseCents}
          comparison={comparisonText(
            summary.expenseCents,
            summary.previous.expenseCents,
            previousName
          )}
        />
      </div>

      <Section>
        <Row
          title='Resultado'
          subtitle='Entradas menos saídas efetivadas'
          trailing={
            <span
              className={cn(
                'font-rounded numeric text-title-3',
                amountTone(summary.netCents) ?? 'text-label-2'
              )}
            >
              {money(Math.abs(summary.netCents))}
            </span>
          }
        />
        {hasPlanned && (
          <>
            <Row
              leading={<Clock className='text-label-2 size-[18px]' />}
              title='Entradas previstas'
              detail={
                <span className='font-rounded text-green/60'>
                  {money(summary.plannedIncomeCents)}
                </span>
              }
            />
            <Row
              leading={<Clock className='text-label-2 size-[18px]' />}
              title='Saídas previstas'
              detail={
                <span className='font-rounded text-red/60'>
                  {money(summary.plannedExpenseCents)}
                </span>
              }
            />
          </>
        )}
      </Section>

      <Section header='Despesas por categoria'>
        {slices.length ? (
          <>
            <Donut slices={slices} total={summary.expenseCents} />
            {slices.map((slice) => (
              <Row
                key={slice.categoryId ?? 'none'}
                leading={<CategoryIcon category={slice.category} size='sm' />}
                title={slice.name}
                trailing={
                  <span className='flex shrink-0 items-baseline gap-2'>
                    <span className='font-rounded numeric text-body'>
                      {money(slice.totalCents)}
                    </span>
                    <span className='font-rounded numeric text-footnote text-label-2 w-10 text-right'>
                      {percentLabel(slice.percent)}
                    </span>
                  </span>
                }
              />
            ))}
          </>
        ) : (
          <EmptyState
            icon={<ChartPie />}
            title='Sem despesas'
            message='As despesas pagas do mês aparecem aqui, por categoria.'
          />
        )}
      </Section>
    </>
  );
}

function BigTile({
  label,
  icon,
  color,
  value,
  comparison,
}: {
  label: string;
  icon: React.ReactNode;
  color: string;
  value: number;
  comparison: string | null;
}) {
  return (
    <div className='bg-surface flex min-w-0 flex-col rounded-[var(--radius)] p-4'>
      <div className='text-subhead flex items-center gap-1.5 font-semibold' style={{ color }}>
        <span className='[&_svg]:size-4'>{icon}</span>
        {label}
      </div>
      <FitText className='font-rounded numeric mt-2 text-[24px] leading-tight font-semibold tracking-tight sm:text-[28px]'>
        {money(value)}
      </FitText>
      <div className='text-footnote text-label-2 mt-1 min-h-[18px]'>{comparison ?? ' '}</div>
    </div>
  );
}

function Donut({ slices, total }: { slices: Slice[]; total: number }) {
  return (
    <div className='relative mx-auto h-60 w-full max-w-[280px]'>
      <ResponsiveContainer width='100%' height='100%'>
        <PieChart>
          <Pie
            data={slices}
            dataKey='totalCents'
            nameKey='name'
            innerRadius='68%'
            outerRadius='92%'
            paddingAngle={slices.length > 1 ? 1.5 : 0}
            cornerRadius={4}
            startAngle={90}
            endAngle={-270}
            stroke='var(--surface)'
            strokeWidth={2}
            animationDuration={500}
          >
            {slices.map((slice) => (
              <Cell key={slice.categoryId ?? 'none'} fill={slice.color} />
            ))}
          </Pie>
          <Tooltip content={<SliceTooltip />} isAnimationActive={false} />
        </PieChart>
      </ResponsiveContainer>
      <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center'>
        <span className='text-caption text-label-2 font-medium uppercase'>Total</span>
        <span className='font-rounded numeric text-title-3'>{money(total)}</span>
      </div>
    </div>
  );
}

function SliceTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const slice = payload[0].payload as Slice;
  return (
    <div className='material rounded-[12px] px-3 py-2 shadow-[0_6px_20px_rgb(0_0_0/0.15)]'>
      <div className='text-caption text-label-2'>{slice.name}</div>
      <div className='font-rounded numeric text-headline'>
        {money(slice.totalCents)}{' '}
        <span className='text-footnote text-label-2'>{percentLabel(slice.percent)}</span>
      </div>
    </div>
  );
}
