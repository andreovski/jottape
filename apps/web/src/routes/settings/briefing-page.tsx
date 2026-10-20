import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  briefingCurrencies,
  type BriefingCurrency,
  type BriefingPluginId,
  type BriefingSettings,
  zodiacSigns,
} from '@jottape/schemas';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronLeft, CloudSun, Equal, MapPin, Search, Sparkles } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { Spinner, Switch } from '@/components/ios/controls';
import { SelectInput, TextInput } from '@/components/ios/fields';
import { IconChip, Row, Section } from '@/components/ios/list';
import { Page } from '@/components/ios/page';
import { Sheet } from '@/components/ios/sheet';
import { briefingCatalog } from '@/components/today/briefing-catalog';
import { useBriefingSettings, useCitySearch, useSaveBriefingSettings } from '@/features/briefing';
import { cn } from '@/lib/utils';

const SIGN_LABELS: Record<(typeof zodiacSigns)[number], string> = {
  aries: '♈ Áries',
  touro: '♉ Touro',
  gemeos: '♊ Gêmeos',
  cancer: '♋ Câncer',
  leao: '♌ Leão',
  virgem: '♍ Virgem',
  libra: '♎ Libra',
  escorpiao: '♏ Escorpião',
  sagitario: '♐ Sagitário',
  capricornio: '♑ Capricórnio',
  aquario: '♒ Aquário',
  peixes: '♓ Peixes',
};

const CURRENCY_LABELS: Record<BriefingCurrency, string> = {
  USD: 'Dólar',
  EUR: 'Euro',
  GBP: 'Libra esterlina',
  BTC: 'Bitcoin',
};

function PluginRow({
  id,
  enabled,
  onToggle,
  handle,
}: {
  id: BriefingPluginId;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  handle?: ReactNode;
}) {
  const info = briefingCatalog[id];
  return (
    <Row
      leading={<IconChip color={info.color}>{info.icon}</IconChip>}
      title={info.name}
      subtitle={<span className='whitespace-normal'>{info.description}</span>}
      trailing={
        <div className='flex items-center gap-3'>
          <Switch label={`Mostrar ${info.name}`} checked={enabled} onChange={onToggle} />
          {handle}
        </div>
      }
    />
  );
}

/** Linha que arrasta pela alça (≡), como na edição de listas do iOS. */
function SortablePluginRow({
  id,
  onToggle,
}: {
  id: BriefingPluginId;
  onToggle: (on: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('bg-surface relative', isDragging && 'z-10 shadow-lg')}
    >
      <PluginRow
        id={id}
        enabled
        onToggle={onToggle}
        handle={
          <button
            type='button'
            ref={setActivatorNodeRef}
            aria-label={`Mover ${briefingCatalog[id].name}`}
            className='text-label-3 -mr-1 cursor-grab touch-none p-1 active:cursor-grabbing'
            {...attributes}
            {...listeners}
          >
            <Equal className='size-6' />
          </button>
        }
      />
    </div>
  );
}

function CitySheet({
  open,
  onOpenChange,
  current,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: BriefingSettings['city'];
  onSelect: (city: BriefingSettings['city']) => void;
}) {
  const [query, setQuery] = useState('');
  const search = useCitySearch(query);
  const results = query.trim().length >= 2 ? (search.data ?? []) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title='Cidade' tall>
      <div className='bg-fill mb-4 flex h-9 items-center gap-2 rounded-[10px] px-2'>
        <Search className='text-label-2 size-4 shrink-0' />
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Buscar cidade'
          enterKeyHint='search'
          aria-label='Buscar cidade'
        />
        {search.isFetching && <Spinner className='text-label-2' />}
      </div>
      {search.isError && (
        <p className='text-footnote text-red px-4 pb-3'>A busca não respondeu. Tente de novo.</p>
      )}
      {results.length > 0 && (
        <Section>
          {results.map((city) => (
            <Row
              key={`${city.latitude},${city.longitude}`}
              leading={<MapPin className='text-label-2 size-5' />}
              title={city.name.split(', ')[0]}
              subtitle={city.name.split(', ').slice(1).join(', ')}
              onClick={() => {
                onSelect(city);
                onOpenChange(false);
                setQuery('');
              }}
            />
          ))}
        </Section>
      )}
      {query.trim().length >= 2 &&
        !search.isFetching &&
        search.isSuccess &&
        results.length === 0 && (
          <p className='text-subhead text-label-2 text-center'>Nenhuma cidade encontrada.</p>
        )}
      {current && query.trim().length < 2 && (
        <Section footer={`Cidade atual: ${current.name}`}>
          <Row
            destructive
            title='Remover cidade'
            onClick={() => {
              onSelect(null);
              onOpenChange(false);
            }}
          />
        </Section>
      )}
    </Sheet>
  );
}

export function BriefingSettingsPage() {
  const navigate = useNavigate();
  const settings = useBriefingSettings();
  const save = useSaveBriefingSettings();
  const [citySheet, setCitySheet] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  const data = settings.data;
  if (!data) {
    return (
      <Page title='Briefing' leading={back}>
        <div className='text-label-2 flex justify-center py-16'>
          <Spinner />
        </div>
      </Page>
    );
  }

  const enabled = data.plugins.filter((p) => p.enabled);
  const disabled = data.plugins.filter((p) => !p.enabled);
  const update = (patch: Partial<BriefingSettings>) => save.mutate({ ...data, ...patch });

  // Ligados primeiro, na ordem da tela; o que liga vai para o fim dos ligados.
  function toggle(id: BriefingPluginId, on: boolean) {
    const rest = data!.plugins.filter((p) => p.id !== id);
    update({
      plugins: [
        ...rest.filter((p) => p.enabled),
        { id, enabled: on },
        ...rest.filter((p) => !p.enabled),
      ],
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = enabled.map((p) => p.id);
    const moved = arrayMove(
      ids,
      ids.indexOf(active.id as BriefingPluginId),
      ids.indexOf(over.id as BriefingPluginId)
    );
    update({ plugins: [...moved.map((id) => ({ id, enabled: true })), ...disabled] });
  }

  const uses = (id: BriefingPluginId) => enabled.some((p) => p.id === id);

  return (
    <Page title='Briefing' leading={back}>
      <p className='text-subhead text-label-2 -mt-2 mb-5'>
        Escolha o que aparece no topo da tela Hoje e arraste para mudar a ordem.
      </p>

      <Section
        footer={
          data.autoOrder
            ? 'A linha do tempo segue o dia: do que passou ao que vem pela frente. Desligue para usar a ordem que você escolher abaixo.'
            : 'A linha do tempo segue a ordem que você escolher abaixo.'
        }
      >
        <Row
          title='Ordem automática'
          trailing={
            <Switch
              label='Ordem automática'
              checked={data.autoOrder}
              onChange={(on) => update({ autoOrder: on })}
            />
          }
        />
      </Section>

      <Section
        header='No briefing'
        footer={
          enabled.length === 0 ? 'Nenhum plugin ligado: o briefing some da tela Hoje.' : undefined
        }
      >
        {enabled.length === 0 ? (
          <Row title={<span className='text-label-2'>Nenhum plugin ligado</span>} />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={enabled.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {enabled.map((p) => (
                <SortablePluginRow key={p.id} id={p.id} onToggle={(on) => toggle(p.id, on)} />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </Section>

      {disabled.length > 0 && (
        <Section header='Mais plugins'>
          {disabled.map((p) => (
            <PluginRow key={p.id} id={p.id} enabled={false} onToggle={(on) => toggle(p.id, on)} />
          ))}
        </Section>
      )}

      <Section
        header='Ajustes dos plugins'
        footer='Clima, horóscopo, cotação e feriados vêm de serviços públicos gratuitos (Open-Meteo, Horoscope App API com tradução do MyMemory, Frankfurter, CoinGecko e BrasilAPI). Só a cidade e o signo saem do app, sem nada que identifique você.'
      >
        <Row
          leading={
            <IconChip color={briefingCatalog.horoscope.color}>
              <Sparkles />
            </IconChip>
          }
          title='Signo'
          disabled={!uses('horoscope')}
          trailing={
            <SelectInput
              value={data.sign ?? ''}
              onChange={(value) => update({ sign: (value || null) as BriefingSettings['sign'] })}
              options={zodiacSigns.map((sign) => ({ value: sign, label: SIGN_LABELS[sign] }))}
              placeholder='Nenhum'
            />
          }
        />
        <Row
          leading={
            <IconChip color={briefingCatalog.weather.color}>
              <CloudSun />
            </IconChip>
          }
          title='Cidade do clima'
          detail={data.city ? data.city.name.split(', ')[0] : 'Nenhuma'}
          chevron
          onClick={() => setCitySheet(true)}
        />
      </Section>

      <Section header='Moedas da cotação'>
        {briefingCurrencies.map((code) => {
          const on = data.currencies.includes(code);
          return (
            <Row
              key={code}
              title={CURRENCY_LABELS[code]}
              detail={code}
              onClick={() =>
                update({
                  currencies: on
                    ? data.currencies.filter((c) => c !== code)
                    : briefingCurrencies.filter((c) => c === code || data.currencies.includes(c)),
                })
              }
              trailing={
                <Check className={cn('text-tint size-5', !on && 'invisible')} strokeWidth={2.6} />
              }
            />
          );
        })}
      </Section>

      <CitySheet
        open={citySheet}
        onOpenChange={setCitySheet}
        current={data.city}
        onSelect={(city) => update({ city })}
      />
    </Page>
  );
}
