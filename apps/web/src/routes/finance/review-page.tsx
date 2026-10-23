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

/** Abaixo disso, a sugestão da IA pede conferência. */
const AI_CONFIRM_BELOW = 0.8;

type Suggestion = Pick<BankMovementResponse, 'suggestionSource' | 'suggestionConfidence'>;

const needsCheck = (m: Suggestion) =>
  m.suggestionSource === 'AI' && (m.suggestionConfidence ?? 0) < AI_CONFIRM_BELOW;

/** De onde veio a categoria: do histórico ou da IA. A regra fixa (Pix → Pix) não leva etiqueta. */
function SourceBadge({ movement }: { movement: Suggestion }) {
  if (movement.suggestionSource !== 'AI' && movement.suggestionSource !== 'HISTORY') return null;
  const check = needsCheck(movement);
  return (
    <span
      className={cn(
        'text-caption-2 ml-1.5 inline-flex h-[18px] shrink-0 items-center rounded-full px-1.5 font-semibold',
        check
          ? 'bg-orange/15 text-orange'
          : movement.suggestionSource === 'AI'
            ? 'bg-tint/15 text-tint'
            : 'bg-fill text-label-2'
      )}
    >
      {movement.suggestionSource === 'HISTORY' ? 'Histórico' : check ? 'Confira' : 'IA'}
    </span>
  );
}

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
                      subtitle={
                        <span className='flex min-w-0 items-center'>
                          <span className='truncate'>
                            {[account?.name, category?.name ?? 'Sem categoria']
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                          {category && <SourceBadge movement={movement} />}
                        </span>
                      }
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

/** De onde veio a categoria sugerida, no rodapé do formulário. */
function suggestionNote(movement: BankMovementResponse): string | null {
  if (movement.suggestionSource === 'HISTORY') {
    return 'A categoria é a do último lançamento parecido.';
  }
  if (movement.suggestionSource === 'AI') {
    return needsCheck(movement)
      ? 'A categoria foi sugerida pela IA, com pouca certeza: confira.'
      : 'A categoria foi sugerida pela IA.';
  }
  return null;
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
      <Section
        footer={[
          `${capitalize(relativeDay(movement.date))}, como veio do banco.`,
          categoryId && categoryId === movement.suggestedCategoryId && suggestionNote(movement),
        ]
          .filter(Boolean)
          .join(' ')}
      >
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
