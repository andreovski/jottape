import { ChevronLeft, ChevronRight } from 'lucide-react';

import { capitalize, monthTitle, todayKey } from '@/lib/format';
import { cn } from '@/lib/utils';

import { monthOfDay, shiftMonth } from './finance-utils';

/** "‹ Outubro de 2026 ›". Tocar no título volta para o mês atual. */
export function MonthSwitcher({
  month,
  onChange,
  className,
}: {
  month: string;
  onChange: (month: string) => void;
  className?: string;
}) {
  const current = monthOfDay(todayKey());
  const isCurrent = month === current;

  return (
    <div className={cn('flex items-center justify-between', className)}>
      <button
        type='button'
        aria-label='Mês anterior'
        onClick={() => onChange(shiftMonth(month, -1))}
        className='text-tint flex size-11 items-center justify-center rounded-full active:opacity-40'
      >
        <ChevronLeft className='size-6' strokeWidth={2.5} />
      </button>
      <button
        type='button'
        onClick={() => onChange(current)}
        disabled={isCurrent}
        aria-label={isCurrent ? undefined : 'Voltar para o mês atual'}
        className='flex flex-col items-center active:opacity-60 disabled:active:opacity-100'
      >
        <span className='text-headline'>{capitalize(monthTitle(month))}</span>
        {!isCurrent && <span className='text-caption text-tint font-medium'>Mês atual</span>}
      </button>
      <button
        type='button'
        aria-label='Próximo mês'
        onClick={() => onChange(shiftMonth(month, 1))}
        className='text-tint flex size-11 items-center justify-center rounded-full active:opacity-40'
      >
        <ChevronRight className='size-6' strokeWidth={2.5} />
      </button>
    </div>
  );
}
