import type { TaskListResponse } from '@jottape/schemas';
import { useState } from 'react';

import { ColorPicker } from '@/components/ios/fields';
import { Section } from '@/components/ios/list';
import { Sheet } from '@/components/ios/sheet';
import { useCreateTaskList, useUpdateTaskList } from '@/features/tasks';
import { cn } from '@/lib/utils';

import { LIST_ICONS, ListIcon } from './icons';

const DEFAULT_COLOR = '#007aff';

/**
 * Informações da lista, como no Lembretes: o círculo grande com o ícone na cor escolhida, o nome
 * centralizado num campo arredondado, as cores e os ícones. Monte com uma `key` nova a cada abertura.
 */
export function ListSheet({
  open,
  onOpenChange,
  list,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: TaskListResponse | null;
  onCreated?: (list: TaskListResponse) => void;
}) {
  const create = useCreateTaskList();
  const update = useUpdateTaskList();
  const [name, setName] = useState(list?.name ?? '');
  const [color, setColor] = useState(list?.color ?? DEFAULT_COLOR);
  const [icon, setIcon] = useState(list?.icon ?? 'list');
  const pending = create.isPending || update.isPending;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (list) {
      await update.mutateAsync({
        id: list.id,
        name: list.isInbox ? undefined : trimmed,
        color,
        icon,
      });
    } else {
      const created = await create.mutateAsync({ name: trimmed, color, icon });
      onCreated?.(created);
    }
    onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      tall
      title={list ? 'Informações da Lista' : 'Nova Lista'}
      confirmLabel={list ? 'OK' : 'Adicionar'}
      confirmDisabled={!name.trim() || pending}
      onConfirm={save}
    >
      <Section>
        <div className='flex flex-col items-center gap-5 px-4 pt-6 pb-5'>
          <span
            className='flex size-[92px] items-center justify-center rounded-full text-white transition-colors duration-200 [&_svg]:size-11'
            style={{
              backgroundColor: color,
              boxShadow: `0 8px 22px color-mix(in srgb, ${color} 38%, transparent)`,
            }}
          >
            <ListIcon icon={icon} inbox={list?.isInbox} />
          </span>
          <input
            aria-label='Nome da lista'
            placeholder='Nome da Lista'
            disabled={list?.isInbox}
            maxLength={60}
            value={name}
            enterKeyHint='done'
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) save();
            }}
            className='bg-fill placeholder:text-label-3 h-[58px] w-full rounded-[12px] px-4 text-center text-[22px] font-bold tracking-tight outline-none disabled:opacity-70'
            style={{ color }}
          />
        </div>
      </Section>

      <Section>
        <ColorPicker value={color} onChange={setColor} />
      </Section>

      <Section>
        <div className='grid grid-cols-6 gap-3 p-4'>
          {Object.entries(LIST_ICONS).map(([key, Icon]) => {
            const active = key === icon;
            return (
              <button
                key={key}
                type='button'
                aria-label={`Ícone ${key}`}
                aria-pressed={active}
                onClick={() => setIcon(key)}
                className={cn(
                  'mx-auto flex size-10 items-center justify-center rounded-full transition-[transform,background-color] active:scale-90',
                  active ? 'text-white' : 'bg-fill text-label-2'
                )}
                style={active ? { backgroundColor: color } : undefined}
              >
                <Icon className='size-5' strokeWidth={2.25} />
              </button>
            );
          })}
        </div>
      </Section>
    </Sheet>
  );
}
