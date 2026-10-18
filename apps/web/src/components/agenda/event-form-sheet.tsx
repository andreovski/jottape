import { addDays, describeRRule } from '@jottape/finance-engine';
import type { EventOccurrence, UpdateEventBody } from '@jottape/schemas';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Switch } from '@/components/ios/controls';
import {
  ColorPicker,
  DateInput,
  FieldRow,
  SelectInput,
  TextArea,
  TextInput,
  TimeInput,
} from '@/components/ios/fields';
import { Section } from '@/components/ios/list';
import { ActionSheet, Sheet } from '@/components/ios/sheet';
import { useCreateEvent, useEvent, useUpdateEvent } from '@/features/agenda';
import { useMe } from '@/features/auth';
import { appTimeZone, weekdayNarrow } from '@/lib/format';
import { cn } from '@/lib/utils';

import { weekdayOrder } from './calendar';
import { LOCAL_COLOR, useCalendars } from './calendars';
import {
  ALERT_OPTIONS,
  alertLabel,
  bodyOf,
  endBeforeStart,
  type EventForm,
  formFromOccurrence,
  REPEAT_OPTIONS,
  type RepeatKind,
  rruleOf,
  shiftSeries,
  withStart,
} from './event-form-model';

export type EventFormMode =
  | { kind: 'create'; initial: EventForm }
  | { kind: 'edit'; event: EventOccurrence };

/** Um domingo qualquer: dá a letra de cada dia da semana. */
const SUNDAY = '2026-10-18';

/**
 * "Cancelar · Novo Evento · Adicionar". Montada de novo a cada abertura (o pai troca a `key`),
 * então o estado inicial vem direto das props.
 */
export function EventFormSheet({
  mode,
  open,
  onOpenChange,
  onSaved,
}: {
  mode: EventFormMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const zone = appTimeZone();
  const me = useMe().data;
  const { status, calendars, calendarOf } = useCalendars();
  const editing = mode.kind === 'edit' ? mode.event : null;
  const [form, setForm] = useState<EventForm>(() =>
    mode.kind === 'create' ? mode.initial : formFromOccurrence(mode.event, zone)
  );
  const [alertTouched, setAlertTouched] = useState(mode.kind === 'edit');
  const [colorOpen, setColorOpen] = useState(false);
  const [askScope, setAskScope] = useState(false);
  const master = useEvent(editing?.isRecurring ? editing.eventId : undefined).data;
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const pending = create.isPending || update.isPending;

  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const invalid = endBeforeStart(form);
  const weekStartsOn = me?.weekStartsOn ?? 0;
  const defaultReminder = me?.defaultReminderMin ?? null;

  const calendarOptions = [
    { value: '', label: 'Jottape' },
    ...(status?.connected
      ? (status.calendars ?? [])
          .filter((calendar) => calendar.selected)
          .map((calendar) => ({ value: calendar.id, label: calendar.name }))
      : []),
  ];
  const calendar = form.calendarId
    ? (calendars.get(form.calendarId) ?? { name: 'Google', color: 'var(--blue)' })
    : editing
      ? calendarOf(editing)
      : { name: 'Jottape', color: LOCAL_COLOR };
  const autoColor = calendar.color;

  const alertValue = form.reminders.length ? String(form.reminders[0]) : '';
  const alertOptions = [
    { value: '', label: 'Nenhum' },
    ...[...new Set([...ALERT_OPTIONS, ...form.reminders.slice(0, 1)])]
      .sort((a, b) => a - b)
      .map((minutes) => ({ value: String(minutes), label: alertLabel(minutes) })),
  ];

  const repeatOptions = [
    ...REPEAT_OPTIONS,
    ...(form.repeat === 'custom' && form.customRRule
      ? [{ value: 'custom', label: describeRRule(form.customRRule) }]
      : []),
  ];

  const finish = (message: string) => {
    toast.success(message);
    onOpenChange(false);
    onSaved?.();
  };

  const save = (scope?: 'single' | 'all') => {
    const body = bodyOf(form, zone);
    if (!editing) {
      create.mutate(body, { onSuccess: () => finish('Evento adicionado') });
      return;
    }

    const rruleChanged = (rruleOf(form) ?? null) !== (editing.rrule ?? null);
    let chosen = scope;
    if (!chosen) {
      if (editing.isRecurring && !rruleChanged) {
        setAskScope(true);
        return;
      }
      chosen = 'all';
    }

    // O calendário não muda depois de criado (a API recusa).
    const { calendarId: _calendar, ...fields } = body;
    void _calendar;
    const payload: Partial<UpdateEventBody> & { id: string } = {
      id: editing.eventId,
      scope: chosen,
      ...fields,
    };

    if (chosen === 'single') {
      payload.occurrenceStart = editing.occurrenceStart;
      delete payload.rrule;
    } else if (editing.isRecurring) {
      const same = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();
      const timesChanged =
        form.allDay !== editing.allDay ||
        !same(fields.startAt, editing.startAt) ||
        !same(fields.endAt, editing.endAt);
      if (!timesChanged) {
        // Só mudou texto/cor/alerta: a série fica onde está.
        delete payload.startAt;
        delete payload.endAt;
      } else if (master) {
        Object.assign(payload, shiftSeries(master, editing, fields));
      }
    }

    update.mutate(payload, { onSuccess: () => finish('Evento salvo') });
  };

  const setAllDay = (allDay: boolean) =>
    setForm((current) => ({
      ...current,
      allDay,
      reminders: alertTouched
        ? current.reminders
        : allDay || defaultReminder === null
          ? []
          : [defaultReminder],
    }));

  const endStyle = invalid ? { textDecoration: 'line-through', color: 'var(--red)' } : undefined;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={editing ? 'Editar Evento' : 'Novo Evento'}
        confirmLabel={editing ? 'OK' : 'Adicionar'}
        confirmDisabled={invalid || pending}
        onConfirm={() => save()}
        tall
      >
        <Section>
          <FieldRow>
            <TextInput
              placeholder='Título'
              value={form.title}
              autoFocus={!editing}
              enterKeyHint='next'
              onChange={(event) => set('title', event.target.value)}
              maxLength={200}
            />
          </FieldRow>
          <FieldRow>
            <TextInput
              placeholder='Local'
              value={form.location}
              onChange={(event) => set('location', event.target.value)}
              maxLength={300}
            />
          </FieldRow>
        </Section>

        <Section>
          <FieldRow label='Dia inteiro'>
            <Switch checked={form.allDay} onChange={setAllDay} label='Dia inteiro' />
          </FieldRow>
          <FieldRow label='Início'>
            <span className='flex flex-wrap justify-end gap-1.5'>
              <DateInput
                aria-label='Data de início'
                value={form.startDate}
                onChange={(event) =>
                  event.target.value && setForm((current) => withStart(current, event.target.value))
                }
              />
              {!form.allDay && (
                <TimeInput
                  aria-label='Hora de início'
                  value={form.startTime}
                  onChange={(event) =>
                    event.target.value &&
                    setForm((current) => withStart(current, current.startDate, event.target.value))
                  }
                />
              )}
            </span>
          </FieldRow>
          <FieldRow label='Término'>
            <span className='flex flex-wrap justify-end gap-1.5'>
              <DateInput
                aria-label='Data de término'
                value={form.endDate}
                style={endStyle}
                onChange={(event) => event.target.value && set('endDate', event.target.value)}
              />
              {!form.allDay && (
                <TimeInput
                  aria-label='Hora de término'
                  value={form.endTime}
                  style={endStyle}
                  onChange={(event) => event.target.value && set('endTime', event.target.value)}
                />
              )}
            </span>
          </FieldRow>
        </Section>

        <Section
          footer={
            editing?.isRecurring
              ? 'Mudar a repetição vale para todos os eventos da série.'
              : undefined
          }
        >
          <FieldRow label='Repetir'>
            <SelectInput
              value={form.repeat}
              options={repeatOptions}
              onChange={(value) => set('repeat', value as RepeatKind)}
            />
          </FieldRow>
          {(form.repeat === 'weekly' || form.repeat === 'biweekly') && (
            <div className='flex justify-between gap-1 px-4 py-2.5 shadow-[inset_0_-0.5px_0_var(--separator)]'>
              {weekdayOrder(weekStartsOn).map((weekday) => {
                const active = form.weekdays.includes(weekday);
                return (
                  <button
                    key={weekday}
                    type='button'
                    aria-pressed={active}
                    aria-label={`Dia da semana ${weekday}`}
                    onClick={() =>
                      setForm((current) => {
                        const next = active
                          ? current.weekdays.filter((d) => d !== weekday)
                          : [...current.weekdays, weekday];
                        return { ...current, weekdays: next.length ? next : current.weekdays };
                      })
                    }
                    className={cn(
                      'text-footnote flex size-9 items-center justify-center rounded-full font-semibold transition-colors duration-150 active:scale-95',
                      active ? 'bg-tint text-white' : 'bg-fill text-foreground'
                    )}
                  >
                    {weekdayNarrow(addDays(SUNDAY, weekday))}
                  </button>
                );
              })}
            </div>
          )}
          {form.repeat !== 'never' && form.repeat !== 'custom' && (
            <>
              <FieldRow label='Fim da repetição'>
                <SelectInput
                  value={form.repeatEnd}
                  options={[
                    { value: 'never', label: 'Nunca' },
                    { value: 'date', label: 'Em data' },
                  ]}
                  onChange={(value) => set('repeatEnd', value as 'never' | 'date')}
                />
              </FieldRow>
              {form.repeatEnd === 'date' && (
                <FieldRow label='Termina em'>
                  <DateInput
                    aria-label='Fim da repetição'
                    value={form.untilDate}
                    min={form.startDate}
                    onChange={(event) =>
                      event.target.value &&
                      set(
                        'untilDate',
                        event.target.value < form.startDate ? form.startDate : event.target.value
                      )
                    }
                  />
                </FieldRow>
              )}
            </>
          )}
        </Section>

        <Section>
          <FieldRow label='Calendário'>
            {editing ? (
              <span className='text-body text-label-2 inline-flex min-w-0 items-center gap-2'>
                <span
                  className='size-2.5 shrink-0 rounded-full'
                  style={{ backgroundColor: calendar.color }}
                />
                <span className='truncate'>{calendar.name}</span>
              </span>
            ) : (
              <span className='inline-flex min-w-0 items-center gap-2'>
                <span
                  className='size-2.5 shrink-0 rounded-full'
                  style={{ backgroundColor: calendar.color }}
                />
                <SelectInput
                  value={form.calendarId ?? ''}
                  options={calendarOptions}
                  onChange={(value) => set('calendarId', value || null)}
                />
              </span>
            )}
          </FieldRow>
          <FieldRow label='Alerta'>
            <SelectInput
              value={alertValue}
              options={alertOptions}
              onChange={(value) => {
                setAlertTouched(true);
                set('reminders', value === '' ? [] : [Number(value), ...form.reminders.slice(1)]);
              }}
            />
          </FieldRow>
          <button
            type='button'
            onClick={() => setColorOpen((value) => !value)}
            aria-expanded={colorOpen}
            className='group/row active:bg-fill flex min-h-11 w-full items-center gap-3 pr-4 pl-4 text-left'
          >
            <span className='text-body flex-1'>Cor</span>
            <span className='text-body text-label-2'>{form.color ? '' : 'Do calendário'}</span>
            <span
              className='size-[22px] rounded-full'
              style={{ backgroundColor: form.color ?? autoColor }}
            />
          </button>
          {colorOpen && (
            <div className='animate-in fade-in hairline-t duration-200'>
              <ColorPicker
                value={form.color}
                onChange={(color) => {
                  set('color', color);
                  setColorOpen(false);
                }}
              />
              <button
                type='button'
                onClick={() => {
                  set('color', null);
                  setColorOpen(false);
                }}
                className='text-body text-tint hairline-t active:bg-fill flex min-h-11 w-full items-center justify-between px-4'
              >
                Usar a cor do calendário
                {!form.color && <Check className='size-[18px]' strokeWidth={2.5} />}
              </button>
            </div>
          )}
        </Section>

        <Section>
          <FieldRow>
            <TextArea
              placeholder='Notas'
              value={form.notes}
              rows={4}
              maxLength={5000}
              onChange={(event) => set('notes', event.target.value)}
            />
          </FieldRow>
        </Section>
      </Sheet>

      <ActionSheet
        open={askScope}
        onOpenChange={setAskScope}
        message='Este é um evento que se repete.'
        actions={[
          { label: 'Salvar só para este evento', onSelect: () => save('single') },
          { label: 'Salvar para todos os eventos', onSelect: () => save('all') },
        ]}
      />
    </>
  );
}
