import { Plus, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Barra de baixo do Lembretes: "+ Novo Lembrete" à esquerda e uma ação à direita. Fica presa logo
 * acima das abas no celular e no pé da tela no computador.
 */
export function BottomBar({ onNew, trailing }: { onNew: () => void; trailing?: ReactNode }) {
  return (
    <div className='material hairline-t sticky bottom-[calc(50px+env(safe-area-inset-bottom))] z-20 -mx-4 mt-6 flex h-12 items-center justify-between px-4 lg:bottom-0 lg:-mx-8 lg:px-8'>
      <button
        type='button'
        onClick={onNew}
        className='text-tint text-headline -ml-1 flex items-center gap-1.5 active:opacity-50'
      >
        <span className='bg-tint flex size-[22px] items-center justify-center rounded-full text-white'>
          <Plus className='size-4' strokeWidth={3} />
        </span>
        Novo Lembrete
      </button>
      {trailing}
    </div>
  );
}

/** Campo de busca do iOS (preenchimento cinza, lupa, "x" para limpar). */
export function SearchField({
  value,
  onChange,
  placeholder = 'Buscar',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className='bg-fill flex h-9 items-center gap-1.5 rounded-[10px] px-2'>
      <Search className='text-label-2 size-[17px] shrink-0' strokeWidth={2.25} />
      <input
        type='search'
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        enterKeyHint='search'
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onChange('');
        }}
        className='text-body placeholder:text-label-2 min-w-0 flex-1 bg-transparent outline-none [&::-webkit-search-cancel-button]:hidden'
      />
      {value && (
        <button
          type='button'
          aria-label='Limpar busca'
          onClick={() => onChange('')}
          className='bg-label-3 flex size-[17px] shrink-0 items-center justify-center rounded-full text-[var(--surface)] active:opacity-60'
        >
          <X className='size-3' strokeWidth={3} />
        </button>
      )}
    </div>
  );
}
