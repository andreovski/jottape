import { addDays, addMonthsClamped } from '@jottape/finance-engine';
import type { EventOccurrence } from '@jottape/schemas';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  coversWholeDay,
  dayRange,
  eventsByDay,
  monthGrid,
  shiftWeek,
  weekDays,
} from '@/components/agenda/calendar';
import { occurrenceKey, useCalendars } from '@/components/agenda/calendars';
import { EventDetailSheet } from '@/components/agenda/event-detail-sheet';
import { newEventForm } from '@/components/agenda/event-form-model';
import { type EventFormMode, EventFormSheet } from '@/components/agenda/event-form-sheet';
import { loadLastView, saveLastView } from '@/components/agenda/last-view';
import { listDayTitle, ListView } from '@/components/agenda/list-view';
import { MonthView } from '@/components/agenda/month-view';
import { AllDayChip, TimeGrid } from '@/components/agenda/time-grid';
import { useNow } from '@/components/agenda/use-now';
import { StripArrow, WeekStrip } from '@/components/agenda/week-strip';
import { Segmented, Skeleton } from '@/components/ios/controls';
import { BarButton, Page } from '@/components/ios/page';
import { useEvents } from '@/features/agenda';
import { useMe } from '@/features/auth';
import { appTimeZone, capitalize, dayKey, monthName, shortDay, startOfDay } from '@/lib/format';
import { cn } from '@/lib/utils';

type View = 'dia' | 'semana' | 'mes' | 'lista';

const VIEWS: { value: View; label: string }[] = [
  { value: 'dia', label: 'Dia' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mês' },
  { value: 'lista', label: 'Lista' },
];

const LIST_DAYS = 60;

const isView = (value: unknown): value is View => VIEWS.some((view) => view.value === value);
const isDay = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

/** Os dias que a visão mostra e os que ela busca (dia busca a semana: trocar de dia é instantâneo). */
function rangeOf(view: View, date: string, weekStartsOn: number) {
  if (view === 'mes') {
    const weeks = monthGrid(date, weekStartsOn);
    return { weeks, days: weeks.flat(), fetchDays: weeks.flat() };
  }
  if (view === 'lista') {
    const days = dayRange(date, LIST_DAYS);
    return { weeks: [], days, fetchDays: days };
  }
  const week = weekDays(date, weekStartsOn);
  return { weeks: [], days: view === 'dia' ? [date] : week, fetchDays: week };
}

export function AgendaPage() {
  const search = useSearch({ from: '/app/agenda' });
  const navigate = useNavigate({ from: '/agenda' });
  const zone = appTimeZone();
  const now = useNow();
  const today = dayKey(new Date(now), zone);
  // Sem visão no link, abre na última que a pessoa usou.
  const [lastView] = useState(() => loadLastView(isView));
  const view: View = isView(search.view) ? search.view : (lastView ?? 'dia');
  const date = isDay(search.date) ? search.date : today;

  const me = useMe().data;
  const weekStartsOn = me?.weekStartsOn ?? 0;
  const { status, calendarOf, colorOf } = useCalendars();

  const { weeks, days, fetchDays } = useMemo(
    () => rangeOf(view, date, weekStartsOn),
    [view, date, weekStartsOn]
  );
  const from = useMemo(() => startOfDay(fetchDays[0]), [fetchDays]);
  const to = useMemo(() => startOfDay(addDays(fetchDays[fetchDays.length - 1], 1)), [fetchDays]);
  const events = useEvents(from, to);
  const byDay = useMemo(
    () => eventsByDay(events.data ?? [], fetchDays, zone),
    [events.data, fetchDays, zone]
  );

  useEffect(() => saveLastView(view), [view]);

  const [detail, setDetail] = useState<EventOccurrence | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [form, setForm] = useState<{ key: number; mode: EventFormMode } | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const go = (next: { view?: View; date?: string }) =>
    navigate({
      search: (previous: { view?: string; date?: string; novo?: string }) => ({
        ...previous,
        ...next,
      }),
      // Trocar de dia não enche o histórico; trocar de visão sim.
      replace: next.view === undefined,
    });
  const setDate = (day: string) => go({ date: day === today ? undefined : day });

  const openForm = (mode: EventFormMode) => {
    setForm((previous) => ({ key: (previous?.key ?? 0) + 1, mode }));
    setFormOpen(true);
  };

  const openCreate = (day = date, hour?: number) =>
    openForm({
      kind: 'create',
      initial: newEventForm({
        date: day,
        hour,
        now: new Date(),
        timeZone: zone,
        defaultReminderMin: me?.defaultReminderMin,
        calendarId: status?.connected ? (status.defaultCalendarId ?? null) : null,
      }),
    });

  const openDetail = (event: EventOccurrence) => {
    setDetail(event);
    setDetailOpen(true);
  };

  const openEdit = (event: EventOccurrence) => {
    setDetailOpen(false);
    openForm({ kind: 'edit', event });
  };

  // /agenda?novo=1 (atalho da tela Hoje): abre a folha de novo evento e limpa o parâmetro.
  const [novoSeen, setNovoSeen] = useState<string | undefined>(undefined);
  if (search.novo !== novoSeen) {
    setNovoSeen(search.novo);
    if (search.novo) openCreate();
  }
  useEffect(() => {
    if (!search.novo) return;
    navigate({
      search: (previous: { view?: string; date?: string; novo?: string }) => ({
        ...previous,
        novo: undefined,
      }),
      replace: true,
    });
  }, [search.novo, navigate]);

  const loading = events.isPending;
  const month = date.slice(0, 7);

  return (
    <Page
      title={capitalize(monthName(month))}
      eyebrow={date.slice(0, 4)}
      actions={
        <>
          <button
            type='button'
            onClick={() => setDate(today)}
            className={cn(
              'text-body text-tint px-2 transition-opacity active:opacity-40',
              date === today && 'opacity-60'
            )}
          >
            Hoje
          </button>
          <BarButton label='Novo evento' onClick={() => openCreate()}>
            <Plus strokeWidth={2.25} />
          </BarButton>
        </>
      }
      accessory={
        <Segmented value={view} onChange={(value) => go({ view: value })} options={VIEWS} />
      }
    >
      {view === 'dia' && (
        <DayView
          date={date}
          today={today}
          weekStartsOn={weekStartsOn}
          byDay={byDay}
          loading={loading}
          colorOf={colorOf}
          onDate={setDate}
          onSelect={openDetail}
          onCreateAt={openCreate}
        />
      )}

      {view === 'semana' && (
        <div className='lg:relative lg:left-1/2 lg:w-[min(calc(100vw-20rem),76rem)] lg:-translate-x-1/2'>
          <div className='mb-2 flex items-center justify-between'>
            <span className='text-headline numeric pl-1'>
              {shortDay(days[0])} – {shortDay(days[6])}
            </span>
            <div className='flex'>
              <StripArrow label='Semana anterior' onClick={() => setDate(shiftWeek(date, -1))}>
                <ChevronLeft />
              </StripArrow>
              <StripArrow label='Próxima semana' onClick={() => setDate(shiftWeek(date, 1))}>
                <ChevronRight />
              </StripArrow>
            </div>
          </div>
          {loading ? (
            <Skeleton className='h-[max(20rem,calc(100dvh-20rem))]' />
          ) : (
            <TimeGrid
              header
              days={days}
              byDay={byDay}
              colorOf={colorOf}
              selectedDay={date}
              onSelectDay={setDate}
              onSelect={openDetail}
              onCreateAt={openCreate}
              className='h-[max(20rem,calc(100dvh-20rem))] lg:h-[max(24rem,calc(100dvh-17rem))]'
            />
          )}
        </div>
      )}

      {view === 'mes' && (
        <MonthView
          date={date}
          today={today}
          weeks={weeks}
          byDay={byDay}
          colorOf={colorOf}
          loading={loading}
          onSelectDay={setDate}
          onShiftMonth={(months) => setDate(addMonthsClamped(date, months))}
          onSelect={openDetail}
          onCreate={() => openCreate()}
        />
      )}

      {view === 'lista' &&
        (loading ? (
          <ListSkeleton />
        ) : (
          <ListView
            days={days}
            today={today}
            byDay={byDay}
            colorOf={colorOf}
            onSelect={openDetail}
            onCreate={() => openCreate()}
          />
        ))}

      <EventDetailSheet
        event={detail}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        calendar={detail ? calendarOf(detail) : null}
        color={detail ? colorOf(detail) : 'var(--red)'}
        onEdit={openEdit}
      />

      {form && (
        <EventFormSheet
          key={form.key}
          mode={form.mode}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      )}
    </Page>
  );
}

function DayView({
  date,
  today,
  weekStartsOn,
  byDay,
  loading,
  colorOf,
  onDate,
  onSelect,
  onCreateAt,
}: {
  date: string;
  today: string;
  weekStartsOn: number;
  byDay: Map<string, EventOccurrence[]>;
  loading: boolean;
  colorOf: ReturnType<typeof useCalendars>['colorOf'];
  onDate: (date: string) => void;
  onSelect: (event: EventOccurrence) => void;
  onCreateAt: (day: string, hour: number) => void;
}) {
  const zone = appTimeZone();
  const allDay = (byDay.get(date) ?? []).filter((event) => coversWholeDay(event, date, zone));
  const marks = useMemo(
    () => new Set([...byDay.entries()].filter(([, list]) => list.length).map(([day]) => day)),
    [byDay]
  );

  return (
    <div>
      <div className='bg-surface mb-2 rounded-[var(--radius)] px-1 py-1'>
        <WeekStrip
          date={date}
          today={today}
          weekStartsOn={weekStartsOn}
          onChange={onDate}
          marks={marks}
        />
      </div>
      <p className='text-footnote text-label-2 mb-2 text-center font-medium'>
        {listDayTitle(date, today)}
      </p>

      {allDay.length > 0 && (
        <div className='mb-2 flex flex-col gap-1'>
          {allDay.map((event) => (
            <AllDayChip
              key={occurrenceKey(event)}
              event={event}
              color={colorOf(event)}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}

      {loading ? (
        <Skeleton className='h-[max(20rem,calc(100dvh-24rem))]' />
      ) : (
        <TimeGrid
          days={[date]}
          byDay={byDay}
          colorOf={colorOf}
          selectedDay={date}
          onSelect={onSelect}
          onCreateAt={onCreateAt}
          className='h-[max(20rem,calc(100dvh-24rem))] lg:h-[max(24rem,calc(100dvh-21rem))]'
        />
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className='flex flex-col gap-5'>
      {[3, 2, 1].map((rows, index) => (
        <div key={index}>
          <Skeleton className='mb-2 ml-4 h-4 w-44' />
          <div className='bg-surface flex flex-col gap-3 rounded-[var(--radius)] p-4'>
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className='flex items-center gap-3'>
                <Skeleton className='h-8 w-12' />
                <Skeleton className='h-8 w-[3px]' />
                <Skeleton className='h-5 flex-1' />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
