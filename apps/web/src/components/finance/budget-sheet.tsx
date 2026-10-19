import type { BudgetStatusResponse } from '@jottape/schemas';
import { useState } from 'react';

import { Button } from '@/components/ios/controls';
import { AmountInput, FieldRow } from '@/components/ios/fields';
import { Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import { useCategories, useDeleteBudget, useUpsertBudget } from '@/features/finance';
import { capitalize, monthTitle } from '@/lib/format';

import { CategoryIcon } from './category-icon';
import { CategoryPicker } from './category-picker';
import { categoryLabel, categoryTree } from './finance-utils';

export interface BudgetSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  budget?: BudgetStatusResponse;
  /** Categorias que já têm orçamento no mês (somem do seletor ao criar). */
  usedCategoryIds: string[];
}

export function BudgetSheet(props: BudgetSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((value) => value + 1);
  }
  return <BudgetForm key={`${props.budget?.id ?? 'new'}-${session}`} {...props} />;
}

function BudgetForm({ open, onOpenChange, month, budget, usedCategoryIds }: BudgetSheetProps) {
  const { data: categories = [] } = useCategories();
  const upsert = useUpsertBudget();
  const remove = useDeleteBudget();
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? '');
  const [limit, setLimit] = useState(budget?.limitCents ?? 0);

  const category = categories.find((c) => c.id === (budget?.categoryId ?? categoryId));
  const groups = categoryTree(categories, 'EXPENSE');
  const valid = Boolean(categoryId) && limit > 0;
  const busy = upsert.isPending || remove.isPending;

  async function save() {
    if (!valid || busy) return;
    const ok = await upsert.mutateAsync({ categoryId, month, limitCents: limit }).then(
      () => true,
      () => false
    );
    if (ok) onOpenChange(false);
  }

  async function destroy() {
    if (!budget) return;
    const ok = await remove.mutateAsync(budget.id).then(
      () => true,
      () => false
    );
    if (ok) onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={budget ? 'Editar Orçamento' : 'Novo Orçamento'}
      confirmLabel={budget ? 'OK' : 'Adicionar'}
      confirmDisabled={!valid || busy}
      onConfirm={save}
    >
      <div className='flex flex-col items-center pt-2 text-center'>
        <CategoryIcon category={category} size='lg' />
        <div className='text-headline mt-2'>
          {category ? categoryLabel(category, categories) : 'Escolha uma categoria'}
        </div>
        <div className='text-footnote text-label-2'>{capitalize(monthTitle(month))}</div>
      </div>

      <AmountInput value={limit} onChange={setLimit} />

      <Section footer='O orçamento de uma categoria também cobre as subcategorias dela.'>
        <FieldRow label='Categoria'>
          {budget ? (
            <span className='text-body text-label-2 truncate'>
              {category ? categoryLabel(category, categories) : '—'}
            </span>
          ) : (
            <CategoryPicker
              value={categoryId}
              onChange={setCategoryId}
              groups={groups}
              kind='EXPENSE'
              disabledIds={usedCategoryIds}
              disabledHint='Já tem orçamento neste mês'
            />
          )}
        </FieldRow>
      </Section>

      {budget && (
        <Button
          variant='destructive'
          className='w-full'
          disabled={busy}
          onClick={() => void destroy()}
        >
          Apagar Orçamento
        </Button>
      )}
    </Sheet>
  );
}
