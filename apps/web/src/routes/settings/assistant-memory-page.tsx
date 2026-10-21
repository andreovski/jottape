import type { AssistantMemoryItem } from '@jottape/schemas';
import { useNavigate } from '@tanstack/react-router';
import { ChevronLeft, CreditCard, Tag } from 'lucide-react';
import { useState } from 'react';

import { Skeleton } from '@/components/ios/controls';
import { IconChip, Row, Section } from '@/components/ios/list';
import { Page } from '@/components/ios/page';
import { ActionSheet } from '@/components/ios/sheet';
import { useAssistantMemory, useForgetMemory } from '@/features/assistant';

// O que o Jotta aprendeu com as correções da pessoa: "iFood" vai no Cartão Nubank. Dá para
// esquecer uma por uma ou tudo.

const FIELD = {
  account: { label: 'Conta', icon: CreditCard, color: 'var(--blue)' },
  category: { label: 'Categoria', icon: Tag, color: 'var(--orange)' },
} as const;

const times = (n: number) => (n === 1 ? 'escolhida 1 vez' : `escolhida ${n} vezes`);

export function AssistantMemoryPage() {
  const navigate = useNavigate();
  const memory = useAssistantMemory();
  const forget = useForgetMemory();
  const [selected, setSelected] = useState<AssistantMemoryItem | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const items = memory.data?.items ?? [];

  const back = (
    <button
      type='button'
      onClick={() => navigate({ to: '/ajustes' })}
      className='text-tint text-body -ml-2 flex items-center active:opacity-40'
    >
      <ChevronLeft className='size-7' strokeWidth={2.2} />
      Ajustes
    </button>
  );

  return (
    <Page title='O que o Jotta aprendeu' leading={back}>
      {!memory.data ? (
        <Skeleton className='h-40 w-full rounded-[var(--radius)]' />
      ) : (
        <>
          <Section footer='Quando você troca a conta ou a categoria num cartão do Jotta, ele lembra para a próxima vez. Ele também olha os seus lançamentos com a mesma descrição. Toque numa linha para esquecer.'>
            {items.length === 0 && (
              <Row title='Nada ainda' subtitle='As suas correções aparecem aqui.' disabled />
            )}
            {items.map((item) => {
              const field = FIELD[item.field];
              const Icon = field.icon;
              return (
                <Row
                  key={item.id}
                  onClick={() => setSelected(item)}
                  leading={
                    <IconChip color={field.color}>
                      <Icon />
                    </IconChip>
                  }
                  title={item.label}
                  subtitle={`${field.label}: ${item.value} · ${times(item.uses)}`}
                  wrapSubtitle
                  className='[&_.truncate]:whitespace-normal'
                />
              );
            })}
          </Section>
          {items.length > 1 && (
            <Section>
              <Row title='Esquecer tudo' destructive onClick={() => setConfirmAll(true)} />
            </Section>
          )}
        </>
      )}

      <ActionSheet
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected ? `${selected.label} → ${selected.value}` : ''}
        message='O Jotta volta a escolher sozinho para esta descrição.'
        actions={[
          {
            label: 'Esquecer',
            destructive: true,
            onSelect: () => selected && forget.mutate(selected.id),
          },
        ]}
      />
      <ActionSheet
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title='Esquecer tudo o que o Jotta aprendeu?'
        actions={[
          { label: 'Esquecer tudo', destructive: true, onSelect: () => forget.mutate(null) },
        ]}
      />
    </Page>
  );
}
