import type { BankAiTrace, BankMovementResponse, CategoryResponse } from '@jottape/schemas';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, CircleCheck, Flag, History, Sparkles } from 'lucide-react';
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
import { useDevMode } from '@/lib/dev-mode';
import { capitalize, money, relativeDay, usd } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BankFeedbackSheet } from '@/routes/settings/bank-feedback-sheet';

/** Abaixo disso, a sugestão da IA pede conferência. */
const AI_CONFIRM_BELOW = 0.8;

const needsCheck = (m: Pick<BankMovementResponse, 'suggestionSource' | 'suggestionConfidence'>) =>
  m.suggestionSource === 'AI' && (m.suggestionConfidence ?? 0) < AI_CONFIRM_BELOW;

/**
 * O ícone da categoria com um selo pequeno de como ela foi escolhida: brilho para a IA (laranja
 * quando pede conferência), relógio para o histórico. A regra fixa (Pix → Pix) não leva selo.
 */
function SuggestedIcon({
  movement,
  category,
}: {
  movement: BankMovementResponse;
  category: CategoryResponse | undefined;
}) {
  const source = category ? movement.suggestionSource : null;
  const Mark = source === 'AI' ? Sparkles : source === 'HISTORY' ? History : null;
  return (
    <span className='relative flex'>
      <CategoryIcon category={category} kind={movement.kind} />
      {Mark && (
        <span
          role='img'
          aria-label={
            source === 'AI'
              ? needsCheck(movement)
                ? 'Sugerida pela IA, confira'
                : 'Sugerida pela IA'
              : 'Pelo histórico'
          }
          className={cn(
            'ring-surface absolute -right-1.5 -bottom-1 flex size-[17px] items-center justify-center rounded-full text-white ring-2',
            source === 'HISTORY' ? 'bg-gray' : needsCheck(movement) ? 'bg-orange' : 'bg-indigo'
          )}
        >
          <Mark className='size-[10px]' strokeWidth={2.75} />
        </span>
      )}
    </span>
  );
}

/** Modo dev: quanto a IA gastou com os que esperam revisão, por IA e no total. */
function AiTotals({ movements }: { movements: BankMovementResponse[] }) {
  const traces = movements.flatMap((m) => (m.aiTrace ? [m.aiTrace] : []));
  if (!traces.length) return null;
  const sum = (pick: (t: BankAiTrace) => number) => traces.reduce((s, t) => s + pick(t), 0);
  const decided = traces.filter((t) => t.decided).length;
  return (
    <Section
      header='Modo dev · IA'
      footer={`A IA olhou ${traces.length} destes lançamentos e sugeriu ${decided}.`}
    >
      <Row
        title='Haiku'
        subtitle={`a parte destes ${traces.length} nos lotes`}
        detail={usd(sum((t) => t.haiku.costMicros))}
      />
      <Row
        title='Jev'
        subtitle={`${sum((t) => t.jev?.inputTokens ?? 0).toLocaleString('pt-BR')} tokens`}
        detail={usd(sum((t) => t.jev?.costMicros ?? 0))}
      />
      <Row
        title={<span className='font-semibold'>Total</span>}
        detail={usd(sum((t) => t.costMicros))}
      />
    </Section>
  );
}

const secs = (ms: number) =>
  (ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** O que cada IA fez e quanto custou, no modo dev (só o dono recebe). */
function AiTraceSection({ trace }: { trace: BankAiTrace }) {
  const tokens = (n: number) => n.toLocaleString('pt-BR');
  return (
    <Section
      header='Modo dev · IA'
      footer={`O Haiku olhou um lote de ${trace.haiku.batchSize}: os tokens são do lote, o custo é a parte deste lançamento. ${trace.decided ? 'Os dois concordaram: a sugestão é da IA.' : 'Não concordaram (ou faltou confiança): a IA não sugeriu.'}`}
    >
      <Row
        title='Haiku'
        wrapSubtitle
        subtitle={`${trace.haiku.pick ?? 'nenhuma'} · ${tokens(trace.haiku.inputTokens)} + ${tokens(trace.haiku.outputTokens)} tokens · ${secs(trace.haiku.ms)} s`}
        detail={usd(trace.haiku.costMicros)}
      />
      <Row
        title='Jev'
        wrapSubtitle
        subtitle={
          trace.jev
            ? `${trace.jev.top ?? 'nenhuma'}${trace.jev.probability !== null ? ` · ${Math.round(trace.jev.probability * 100)}%` : ''} · ${tokens(trace.jev.inputTokens)} tokens · ${secs(trace.jev.ms)} s`
            : 'Não respondeu'
        }
        detail={usd(trace.jev?.costMicros ?? 0)}
      />
      <Row title={<span className='font-semibold'>Total</span>} detail={usd(trace.costMicros)} />
    </Section>
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
  const devMode = useDevMode();

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
                      leading={<SuggestedIcon movement={movement} category={category} />}
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
          {devMode && <AiTotals movements={list} />}
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
  const devMode = useDevMode();

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
      {devMode && movement.aiTrace && <AiTraceSection trace={movement.aiTrace} />}
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
