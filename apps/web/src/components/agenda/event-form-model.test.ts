import type { EventOccurrence } from '@jottape/schemas';
import { describe, expect, it } from 'vitest';

import {
  alertLabel,
  bodyOf,
  endBeforeStart,
  formFromOccurrence,
  newEventForm,
  rruleOf,
  shiftSeries,
  withStart,
} from './event-form-model';

const TZ = 'America/Sao_Paulo';

const base = () =>
  newEventForm({
    date: '2026-10-20',
    now: new Date('2026-10-18T15:20:00.000Z'),
    timeZone: TZ,
    defaultReminderMin: 15,
    calendarId: null,
  });

describe('novo evento', () => {
  it('outro dia começa às 9h, dura 1 h e tem o alerta padrão', () => {
    expect(base()).toMatchObject({
      startDate: '2026-10-20',
      startTime: '09:00',
      endDate: '2026-10-20',
      endTime: '10:00',
      reminders: [15],
      weekdays: [2],
    });
  });

  it('hoje começa na próxima hora cheia', () => {
    const form = newEventForm({
      date: '2026-10-18',
      now: new Date('2026-10-18T15:20:00.000Z'), // 12:20 em São Paulo
      timeZone: TZ,
      defaultReminderMin: null,
      calendarId: 'cal',
    });
    expect(form).toMatchObject({
      startTime: '13:00',
      endTime: '14:00',
      reminders: [],
      calendarId: 'cal',
    });
  });

  it('às 23h o término vai para o dia seguinte', () => {
    const form = newEventForm({
      date: '2026-10-20',
      now: new Date(),
      timeZone: TZ,
      defaultReminderMin: null,
      calendarId: null,
      hour: 23,
    });
    expect(form).toMatchObject({ endDate: '2026-10-21', endTime: '00:00' });
  });
});

describe('início e término', () => {
  it('mover o início leva o término junto', () => {
    const form = { ...base(), endTime: '10:30' };
    const moved = withStart(form, '2026-10-20', '22:00');
    expect(moved).toMatchObject({ endDate: '2026-10-20', endTime: '23:30' });
    const crossing = withStart(form, '2026-10-20', '23:00');
    expect(crossing).toMatchObject({ endDate: '2026-10-21', endTime: '00:30' });
  });

  it('dia inteiro: mover o dia leva o fim junto', () => {
    const form = { ...base(), allDay: true, endDate: '2026-10-22' };
    expect(withStart(form, '2026-10-25')).toMatchObject({ endDate: '2026-10-27' });
  });

  it('repetição semanal acompanha o dia da semana do início', () => {
    const moved = withStart(base(), '2026-10-21');
    expect(moved.weekdays).toEqual([3]);
  });

  it('acusa término antes do início', () => {
    expect(endBeforeStart({ ...base(), endTime: '08:00' })).toBe(true);
    expect(endBeforeStart({ ...base(), endTime: '09:00' })).toBe(false);
  });
});

describe('conversão para a API', () => {
  it('com hora vira instante no fuso', () => {
    const body = bodyOf({ ...base(), title: ' Dentista ' }, TZ);
    expect(body).toMatchObject({
      title: 'Dentista',
      startAt: '2026-10-20T12:00:00.000Z',
      endAt: '2026-10-20T13:00:00.000Z',
      allDay: false,
      rrule: null,
      calendarId: null,
      location: null,
    });
  });

  it('dia inteiro vira meias-noites UTC com fim exclusivo', () => {
    const body = bodyOf({ ...base(), allDay: true, endDate: '2026-10-21' }, TZ);
    expect(body.startAt).toBe('2026-10-20T00:00:00.000Z');
    expect(body.endAt).toBe('2026-10-22T00:00:00.000Z');
    expect(body.title).toBe('Novo Evento');
  });

  it('regras de repetição', () => {
    expect(rruleOf({ ...base(), repeat: 'daily' })).toBe('FREQ=DAILY');
    expect(rruleOf({ ...base(), repeat: 'weekly', weekdays: [1, 3] })).toBe(
      'FREQ=WEEKLY;BYDAY=MO,WE'
    );
    expect(rruleOf({ ...base(), repeat: 'biweekly' })).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU');
    expect(
      rruleOf({ ...base(), repeat: 'monthly', repeatEnd: 'date', untilDate: '2026-12-31' })
    ).toBe('FREQ=MONTHLY;UNTIL=20261231T235959Z');
  });
});

describe('edição', () => {
  const occurrence: EventOccurrence = {
    eventId: 'e',
    occurrenceStart: '2026-10-21T12:00:00.000Z',
    startAt: '2026-10-21T12:00:00.000Z',
    endAt: '2026-10-21T13:30:00.000Z',
    allDay: false,
    title: 'Pilates',
    description: 'Levar toalha',
    location: 'Studio',
    color: '#34c759',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
    isRecurring: true,
    isException: false,
    source: 'LOCAL',
    calendarId: null,
    reminders: [30],
  };

  it('lê a ocorrência no fuso e reconhece a repetição', () => {
    expect(formFromOccurrence(occurrence, TZ)).toMatchObject({
      title: 'Pilates',
      notes: 'Levar toalha',
      startDate: '2026-10-21',
      startTime: '09:00',
      endTime: '10:30',
      repeat: 'weekly',
      weekdays: [1, 3],
      reminders: [30],
      color: '#34c759',
    });
  });

  it('regra fora das opções fica como personalizada e é mantida', () => {
    const form = formFromOccurrence({ ...occurrence, rrule: 'FREQ=MONTHLY;INTERVAL=3' }, TZ);
    expect(form.repeat).toBe('custom');
    expect(rruleOf(form)).toBe('FREQ=MONTHLY;INTERVAL=3');
  });

  it('dia inteiro: o último dia é o anterior ao fim exclusivo', () => {
    const form = formFromOccurrence(
      {
        ...occurrence,
        allDay: true,
        startAt: '2026-10-21T00:00:00.000Z',
        endAt: '2026-10-23T00:00:00.000Z',
      },
      TZ
    );
    expect(form).toMatchObject({ startDate: '2026-10-21', endDate: '2026-10-22' });
  });

  it('editar a série aplica a mudança de horário ao início da série', () => {
    const shifted = shiftSeries(
      { startAt: '2026-10-05T12:00:00.000Z', endAt: '2026-10-05T13:30:00.000Z' },
      occurrence,
      { startAt: '2026-10-21T13:00:00.000Z', endAt: '2026-10-21T14:00:00.000Z' }
    );
    expect(shifted).toEqual({
      startAt: '2026-10-05T13:00:00.000Z',
      endAt: '2026-10-05T14:00:00.000Z',
    });
  });
});

describe('alertLabel', () => {
  it('textos do iPhone', () => {
    expect(alertLabel(0)).toBe('Na hora do evento');
    expect(alertLabel(15)).toBe('15 minutos antes');
    expect(alertLabel(60)).toBe('1 hora antes');
    expect(alertLabel(120)).toBe('2 horas antes');
    expect(alertLabel(2880)).toBe('2 dias antes');
  });
});
