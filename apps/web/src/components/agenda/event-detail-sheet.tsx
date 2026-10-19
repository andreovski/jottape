import { describeRRule } from '@jottape/finance-engine';
import type { EventOccurrence } from '@jottape/schemas';
import { Bell, CalendarDays, MapPin, Repeat } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ios/controls';
import { Section } from '@/components/ios/list';
import { ActionSheet, Sheet } from '@/components/ios/sheet';
import { useDeleteEvent } from '@/features/agenda';
import {
  appTimeZone,
  capitalize,
  duration,
  longDay,
  shortDay,
  time,
  timeRange,
} from '@/lib/format';

import { occurrenceSpan } from './calendar';
import type { CalendarInfo } from './calendars';
import { alertLabel } from './event-form-model';

const withYear = (day: string) => `${longDay(day)} de ${day.slice(0, 4)}`;

/** As linhas de data do detalhe ("sábado, 18 de outubro de 2026" / "09:00 – 10:30 · 1 h 30"). */
export function whenLines(event: EventOccurrence, zone = appTimeZone()): [string, string] {
  const { first, last } = occurrenceSpan(event, zone);
  if (event.allDay) {
    if (first === last) return [capitalize(withYear(first)), 'Dia inteiro'];
    return [`De ${shortDay(first)} até ${shortDay(last)} de ${last.slice(0, 4)}`, 'Dia inteiro'];
  }
  if (first === last) {
    return [
      capitalize(withYear(first)),
      `${timeRange(event.startAt, event.endAt)} · ${duration(event.startAt, event.endAt)}`,
    ];
  }
  return [
    `De ${shortDay(first)}, ${time(event.startAt)}`,
    `até ${shortDay(last)}, ${time(event.endAt)} · ${duration(event.startAt, event.endAt)}`,
  ];
}

export function EventDetailSheet({
  event,
  open,
  onOpenChange,
  calendar,
  color,
  onEdit,
}: {
  event: EventOccurrence | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendar: CalendarInfo | null;
  color: string;
  onEdit: (event: EventOccurrence) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteEvent();

  const destroy = (scope: 'single' | 'all') => {
    if (!event) return;
    remove.mutate(
      {
        id: event.eventId,
        scope,
        ...(scope === 'single' ? { occurrenceStart: event.occurrenceStart } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Evento apagado');
          onOpenChange(false);
        },
      }
    );
  };

  const [dateLine, timeLine] = event ? whenLines(event) : ['', ''];

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title='Detalhes do Evento'
        cancelLabel='Fechar'
        confirmLabel='Editar'
        onConfirm={() => event && onEdit(event)}
      >
        {event && (
          <div className='pt-1'>
            <div className='mb-6 flex gap-3 px-1'>
              <span className='mt-1 w-1 shrink-0 rounded-full' style={{ backgroundColor: color }} />
              <div className='min-w-0'>
                <h2 className='text-title-2 break-words'>{event.title}</h2>
                {event.location && (
                  <p className='text-subhead text-label-2 mt-0.5 break-words'>{event.location}</p>
                )}
                <p className='text-subhead mt-3'>{dateLine}</p>
                <p className='text-subhead text-label-2 numeric'>{timeLine}</p>
                {event.rrule && (
                  <p className='text-subhead text-label-2 mt-1 flex items-center gap-1.5'>
                    <Repeat className='size-3.5' strokeWidth={2.25} />
                    {describeRRule(event.rrule)}
                    {event.isException && ' · alterado só neste dia'}
                  </p>
                )}
              </div>
            </div>

            <Section>
              <DetailRow icon={<CalendarDays />} label='Calendário'>
                <span className='inline-flex min-w-0 items-center gap-2'>
                  <span
                    className='size-2.5 shrink-0 rounded-full'
                    style={{ backgroundColor: calendar?.color ?? color }}
                  />
                  <span className='truncate'>
                    {calendar?.name ?? 'Jottape'}
                    {calendar?.account && (
                      <span className='text-label-2'> · {calendar.account}</span>
                    )}
                  </span>
                </span>
              </DetailRow>
              <DetailRow icon={<Bell />} label='Alerta'>
                {event.reminders.length
                  ? [...event.reminders]
                      .sort((a, b) => a - b)
                      .map(alertLabel)
                      .join(', ')
                  : 'Nenhum'}
              </DetailRow>
              {event.location && (
                <DetailRow icon={<MapPin />} label='Local'>
                  <a
                    className='text-tint'
                    href={`https://maps.apple.com/?q=${encodeURIComponent(event.location)}`}
                    target='_blank'
                    rel='noreferrer'
                  >
                    Abrir no Mapas
                  </a>
                </DetailRow>
              )}
            </Section>

            {event.description && (
              <Section header='Notas'>
                <p className='text-body px-4 py-3 break-words whitespace-pre-wrap'>
                  {event.description}
                </p>
              </Section>
            )}

            <Button
              variant='destructive'
              className='w-full'
              loading={remove.isPending}
              onClick={() => setConfirming(true)}
            >
              Apagar evento
            </Button>
          </div>
        )}
      </Sheet>

      <ActionSheet
        open={confirming}
        onOpenChange={setConfirming}
        message={
          event?.isRecurring
            ? 'Este é um evento que se repete.'
            : 'Tem certeza de que deseja apagar este evento?'
        }
        actions={
          event?.isRecurring
            ? [
                {
                  label: 'Apagar só este evento',
                  destructive: true,
                  onSelect: () => destroy('single'),
                },
                {
                  label: 'Apagar todos os eventos',
                  destructive: true,
                  onSelect: () => destroy('all'),
                },
              ]
            : [{ label: 'Apagar evento', destructive: true, onSelect: () => destroy('all') }]
        }
      />
    </>
  );
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className='group/row flex min-h-11 items-center gap-3 pl-4'>
      <span className='text-label-2 [&_svg]:size-[18px]'>{icon}</span>
      <div className='flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2.5 pr-4 shadow-[inset_0_-0.5px_0_var(--separator)] group-last/row:shadow-none'>
        <span className='text-body shrink-0'>{label}</span>
        <span className='text-body text-label-2 min-w-0 flex-1 truncate text-right'>
          {children}
        </span>
      </div>
    </div>
  );
}
