import type { BudgetStatusResponse, CategoryResponse } from '@jottape/schemas';
import { Copy, Target } from 'lucide-react';

import { BudgetSheet } from '@/components/finance/budget-sheet';
import { CategoryIcon } from '@/components/finance/category-icon';
import {
  BUDGET_LEVEL_COLORS,
  budgetBar,
  categoryLabel,
  shiftMonth,
} from '@/components/finance/finance-utils';
import { MonthSwitcher } from '@/components/finance/month-switcher';
import { useSheetState } from '@/components/finance/use-sheet-state';
import { Button, EmptyState, Skeleton } from '@/components/ios/controls';
import { Section } from '@/components/ios/list';
import { useBudgets, useCategories, useCopyBudgets } from '@/features/finance';
import { money, monthName } from '@/lib/format';

export function BudgetsTab({
  month,
  onMonthChange,
}: {
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const { data: budgets, isLoading } = useBudgets(month);
  const { data: previous } = useBudgets(shiftMonth(month, -1));
  const { data: categories = [] } = useCategories();
  const copy = useCopyBudgets();
  const sheet = useSheetState<BudgetStatusResponse>();

  const list = budgets ?? [];
  const canCopy = !isLoading && list.length === 0 && (previous?.length ?? 0) > 0;
  const totalLimit = list.reduce((sum, b) => sum + b.limitCents, 0);
  const totalSpent = list.reduce((sum, b) => sum + b.spentCents, 0);

  return (
    <div>
      <MonthSwitcher month={month} onChange={onMonthChange} className='-mx-2 mb-4' />

      {isLoading ? (
        <div className='bg-surface space-y-5 rounded-[var(--radius)] p-4'>
          {[0, 1, 2].map((i) => (
            <div key={i} className='flex gap-3'>
              <Skeleton className='size-[29px] rounded-full' />
              <div className='flex-1 space-y-2'>
                <Skeleton className='h-3.5 w-1/3' />
                <Skeleton className='h-2 w-full' />
              </div>
            </div>
          ))}
        </div>
      ) : list.length ? (
        <>
          <div className='mb-4 px-1'>
            <div className='text-footnote text-label-2'>Gasto no mês</div>
            <div className='font-rounded numeric text-title-2'>
              {money(totalSpent)}{' '}
              <span className='text-subhead text-label-2 font-normal'>de {money(totalLimit)}</span>
            </div>
          </div>
          <Section>
            {list.map((budget) => (
              <BudgetRow
                key={budget.id}
                budget={budget}
                categories={categories}
                onClick={() => sheet.show(budget)}
              />
            ))}
          </Section>
        </>
      ) : (
        <Section>
          <EmptyState
            icon={<Target />}
            title='Nenhum orçamento'
            message={`Defina quanto quer gastar por categoria em ${monthName(month)}.`}
            action={
              canCopy && (
                <Button
                  size='md'
                  variant='tinted'
                  loading={copy.isPending}
                  onClick={() => copy.mutate(month)}
                >
                  <Copy className='size-4' /> Copiar do mês anterior
                </Button>
              )
            }
          />
        </Section>
      )}

      <Button variant='tinted' className='w-full' onClick={() => sheet.show(undefined)}>
        Definir orçamento
      </Button>

      <BudgetSheet
        open={sheet.open}
        onOpenChange={sheet.onOpenChange}
        month={month}
        budget={sheet.value}
        usedCategoryIds={list.map((b) => b.categoryId)}
      />
    </div>
  );
}

function BudgetRow({
  budget,
  categories,
  onClick,
}: {
  budget: BudgetStatusResponse;
  categories: CategoryResponse[];
  onClick: () => void;
}) {
  const category = categories.find((c) => c.id === budget.categoryId) ?? null;
  const bar = budgetBar(budget);
  const color = BUDGET_LEVEL_COLORS[bar.level];

  return (
    <button
      type='button'
      onClick={onClick}
      className='group/row active:bg-fill flex w-full items-start gap-3 pl-4 text-left transition-colors duration-75'
    >
      <div className='py-3'>
        <CategoryIcon category={category} />
      </div>
      <div className='min-w-0 flex-1 py-3 pr-4 shadow-[inset_0_-0.5px_0_var(--separator)] group-last/row:shadow-none'>
        <div className='flex items-baseline justify-between gap-3'>
          <span className='text-body truncate'>
            {category ? categoryLabel(category, categories) : 'Categoria'}
          </span>
          <span className='font-rounded numeric text-subhead text-label-2 shrink-0'>
            <span className='text-foreground font-semibold'>{money(budget.spentCents)}</span> de{' '}
            {money(budget.limitCents)}
          </span>
        </div>
        <div
          className='bg-fill mt-2 flex h-2 overflow-hidden rounded-[8px]'
          role='progressbar'
          aria-valuemin={0}
          aria-valuemax={budget.limitCents}
          aria-valuenow={budget.spentCents}
        >
          <div
            className='h-full rounded-[8px] transition-[width] duration-500'
            style={{ width: `${bar.spentWidth}%`, backgroundColor: color }}
          />
          {bar.plannedWidth > 0 && (
            <div
              className='h-full rounded-r-[8px]'
              style={{
                width: `${bar.plannedWidth}%`,
                backgroundColor: `color-mix(in srgb, ${color} 35%, transparent)`,
              }}
            />
          )}
        </div>
        <div className='text-footnote mt-1.5 flex justify-between gap-3'>
          <span style={bar.level === 'ok' ? undefined : { color }} className='text-label-2'>
            {bar.remainingCents >= 0
              ? `Restam ${money(bar.remainingCents)}`
              : `${money(-bar.remainingCents)} acima`}
          </span>
          {budget.plannedCents > 0 && (
            <span className='text-label-2'>+ {money(budget.plannedCents)} previsto</span>
          )}
        </div>
      </div>
    </button>
  );
}
