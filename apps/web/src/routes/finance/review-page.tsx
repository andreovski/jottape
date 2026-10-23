import type { BankMovementResponse } from '@jottape/schemas';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, CircleCheck, Flag } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { CategoryIcon } from '@/components/finance/category-icon';
import { CategoryPicker } from '@/components/finance/category-picker';
import { categoryTree } from '@/components/finance/finance-utils';
import { Button, EmptyState, Segmented, Skeleton } from '@/components/ios/controls';
import { FieldRow, TextArea, TextInput } from '@/components/ios/fields';
import { Row, Section } from '@/components/ios/list';
import { Page } from '@/components/ios/page';
import { Sheet } from '@/components/ios/sheet';
import {
  useAcceptAllMovements,
  useAcceptMovement,
  useIgnoreMovement,
  usePendingMovements,
} from '@/features/bank';
import { useAccounts, useCategories } from '@/features/finance';
import { capitalize, money, relativeDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BankFeedbackSheet } from '@/routes/settings/bank-feedback-sheet';

/** Lançamentos que vieram do banco e não casaram com nada: o usuário confere antes do saldo. */
export function ReviewPage() {
  const navigate = useNavigate();
  const movements = usePendingMovements();
  const accounts = useAccounts().data ?? [];
  const categories = useCategories().data ?? [];
  const acceptAll = useAcceptAllMovements();
  const [open, setOpen] = useState<BankMovementResponse | null>(null);

  const back = (
    <button
      type='button'
      onClick={() => navigate({ to: '/financas' })}
      className='text-tint text-body -ml-2 flex items-center active:opacity-40'
    >
      <ChevronLeft className='size-7' strokeWidth={2.2} />
      Finanças
    </button>
  );

  const list = movements.data ?? [];
  const days = [...new Set(list.map((m) => m.date))];
  const withCategory = list.filter((m) => m.suggestedCategoryId).length;

  return (
    <Page title='A revisar' leading={back}>
      {movements.isPending ? (
        <Skeleton className='h-40' />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<CircleCheck />}
          title='Tudo revisado'
          message={
            <>
              Os lançamentos novos dos seus bancos aparecem aqui.{' '}
              <Link to='/ajustes/bancos' className='text-tint'>
                Bancos
              </Link>
            </>
          }
        />
      ) : (
        <>
          <p className='text-subhead text-label-2 mb-4 px-1'>
            Vieram do banco e não batem com nada que você lançou. Toque para ajustar a categoria, ou
            lance todos de uma vez
            {withCategory ? ` (${withCategory} já com categoria sugerida)` : ''}.
          </p>
          <Button
            className='mb-7 w-full'
            loading={acceptAll.isPending}
            onClick={async () => {
              const { imported } = await acceptAll.mutateAsync();
              toast.success(`${imported} lançamento(s) adicionados.`);
            }}
          >
            Lançar todos ({list.length})
          </Button>
          {days.map((day) => (
            <Section key={day} header={capitalize(relativeDay(day))}>
              {list
                .filter((m) => m.date === day)
                .map((movement) => {
                  const category = categories.find((c) => c.id === movement.suggestedCategoryId);
                  const account = accounts.find((a) => a.id === movement.accountId);
                  return (
                    <Row
                      key={movement.id}
                      onClick={() => setOpen(movement)}
                      leading={<CategoryIcon category={category} kind={movement.kind} />}
                      title={movement.description}
                      subtitle={[account?.name, category?.name ?? 'Sem categoria']
                        .filter(Boolean)
                        .join(' · ')}
                      trailing={
                        <span
                          className={cn(
                            'font-rounded numeric text-body',
                            movement.kind === 'INCOME' && 'text-green'
                          )}
                        >
                          {movement.kind === 'INCOME' ? '+' : '−'} {money(movement.amountCents)}
                        </span>
                      }
                    />
                  );
                })}
            </Section>
          ))}
        </>
      )}
      {open && <ReviewSheet movement={open} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function ReviewSheet({
  movement,
  onClose,
}: {
  movement: BankMovementResponse;
  onClose: () => void;
}) {
  const categories = useCategories().data ?? [];
  const accept = useAcceptMovement();
  const ignore = useIgnoreMovement();
  const [kind, setKind] = useState(movement.kind);
  const [categoryId, setCategoryId] = useState(movement.suggestedCategoryId ?? '');
  const [description, setDescription] = useState(movement.description);
  // O texto do banco vai nas notas quando o título é outro; dá para mudar ou apagar.
  const [notes, setNotes] = useState(
    movement.bankDescription !== movement.description ? movement.bankDescription : ''
  );
  const [reporting, setReporting] = useState(false);

  async function save() {
    await accept.mutateAsync({
      id: movement.id,
      body: {
        kind,
        categoryId: categoryId || null,
        ...(description.trim() && description.trim() !== movement.description
          ? { description: description.trim() }
          : {}),
        notes: notes.trim() || null,
      },
    });
    onClose();
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title='Do banco'
      confirmLabel='Lançar'
      confirmDisabled={accept.isPending}
      onConfirm={save}
    >
      <div
        className={cn(
          'font-rounded numeric py-4 text-center text-[44px] font-semibold',
          kind === 'INCOME' ? 'text-green' : 'text-red'
        )}
      >
        {money(movement.amountCents)}
      </div>
      <Segmented
        className='mb-5'
        value={kind}
        onChange={(value) => {
          setKind(value);
          setCategoryId('');
        }}
        options={[
          { value: 'EXPENSE', label: 'Despesa' },
          { value: 'INCOME', label: 'Receita' },
        ]}
      />
      <Section footer={`${capitalize(relativeDay(movement.date))}, como veio do banco.`}>
        <FieldRow>
          <TextInput
            placeholder='Descrição'
            value={description}
            maxLength={120}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FieldRow>
        <FieldRow label='Categoria'>
          <CategoryPicker
            value={categoryId}
            onChange={setCategoryId}
            groups={categoryTree(categories, kind)}
            kind={kind}
            placeholder='Nenhuma'
          />
        </FieldRow>
        <FieldRow>
          <TextArea
            placeholder='Notas'
            aria-label='Notas'
            value={notes}
            maxLength={2000}
            onChange={(event) => setNotes(event.target.value)}
          />
        </FieldRow>
      </Section>
      <Button
        variant='destructive'
        className='w-full'
        loading={ignore.isPending}
        onClick={async () => {
          await ignore.mutateAsync(movement.id);
          onClose();
        }}
      >
        Ignorar (não lançar)
      </Button>
      <button
        type='button'
        onClick={() => setReporting(true)}
        className='text-tint text-subhead mx-auto mt-4 flex items-center gap-1.5 active:opacity-40'
      >
        <Flag className='size-4' /> Algo veio errado
      </button>
      <BankFeedbackSheet
        open={reporting}
        nested
        movementId={movement.id}
        onClose={() => setReporting(false)}
      />
    </Sheet>
  );
}
