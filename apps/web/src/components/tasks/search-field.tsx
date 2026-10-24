import { Search, X } from 'lucide-react';

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
