import { addDays } from '@jottape/finance-engine';
import type { EventOccurrence, TaskResponse, TransactionResponse } from '@jottape/schemas';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CalendarDays,
  CircleCheck,
  CreditCard,
  Eye,
  EyeOff,
  MapPin,
  Plus,
  Receipt,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { toast } from 'sonner';

import { CategoryIcon } from '@/components/finance/category-icon';
import { TransactionSheet } from '@/components/finance/transaction-sheet';
import { InstallInvite } from '@/components/install-invite';
import { CheckCircle, EmptyState, Skeleton } from '@/components/ios/controls';
import { Row, Section } from '@/components/ios/list';
import { BarButton, Page } from '@/components/ios/page';
import { ActionSheet } from '@/components/ios/sheet';
import { SettingsButton } from '@/components/settings-button';
import { TaskGroupLabel } from '@/components/tasks/task-row';
import { BriefingCard } from '@/components/today/briefing-card';
import { useAgenda } from '@/features/agenda';
import { useCurrentUser } from '@/features/auth';
import { useNextEvent } from '@/features/briefing';
import { useAccounts, useCategories, useForecast, useUpdateTransaction } from '@/features/finance';
import { useCompleteTask, useTasks } from '@/features/tasks';
import {
  capitalize,
  dayKey,
  longDay,
  relativeDay,
  shortDay,
  startOfDay,
  time,
  todayKey,
} from '@/lib/format';
import { useHiddenMoney } from '@/lib/hidden-money';
import { cn } from '@/lib/utils';

import { eventDay, greeting, nextUpcoming, sortUndated, taskProgress } from './today';

/** Cartão no formato dos widgets da Tela de Início. */
function Widget({
  title,
  icon,
  color,
  children,
  className,
  to,
  accessory,
}: {
  title: string;
  icon: ReactNode;
  color: string;
  children: ReactNode;
  className?: string;
  to?: string;
  /** Botão no canto de cima, fora do link do widget. */
  accessory?: ReactNode;
}) {
  const body = (
    <div
      className={cn(
        'bg-surface flex h-full min-h-[148px] flex-col rounded-[22px] p-[14px] transition-transform active:scale-[0.98]',
        !to && className
      )}
    >
      <div className='text-footnote mb-1 flex items-center gap-1.5 font-semibold' style={{ color }}>
        <span className='[&_svg]:size-[15px]'>{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
  const card = to ? (
    <Link to={to} className={cn('block h-full', !accessory && className)}>
      {body}
    </Link>
  ) : (
    body
  );
  if (!accessory) return card;
  return (
    <div className={cn('relative', className)}>
      {card}
      <div className='absolute top-1.5 right-1.5'>{accessory}</div>
    </div>
  );
}

/** Anel do app Atividade. */
function Ring({ value, color, size = 84 }: { value: number; color: string; size?: number }) {
  const stroke = 11;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(1, Math.max(0, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className='-rotate-90'>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill='none'
        stroke={color}
        strokeOpacity={0.22}
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill='none'
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap='round'
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        className='transition-[stroke-dashoffset] duration-700 ease-out'
      />
    </svg>
  );
}

function BalanceWidget({
  format,
  hidden,
  onToggleHidden,
}: {
  format: (cents: number) => string;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const accounts = useAccounts();
  const forecast = useForecast(30);
  const available = (accounts.data ?? [])
    .filter((a) => a.type !== 'CREDIT_CARD')
    .reduce((sum, a) => sum + a.balanceCents, 0);
  const days = forecast.data?.days ?? [];
  const end = days.at(-1)?.totalCents;
  const negative = forecast.data?.firstNegative;
  const color = negative ? 'var(--red)' : 'var(--green)';

  return (
    <Widget
      title='Saldo'
      icon={<Wallet />}
      color='var(--green)'
      to='/financas'
      className='col-span-2'
      accessory={
        <button
          type='button'
          onClick={onToggleHidden}
          aria-label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
          aria-pressed={hidden}
          className='text-label-2 flex size-9 items-center justify-center rounded-full active:opacity-40 [&_svg]:size-[18px]'
        >
          {hidden ? <EyeOff /> : <Eye />}
        </button>
      }
    >
      {accounts.isPending ? (
        <Skeleton className='mt-2 h-10 w-40' />
      ) : (
        <div className='flex flex-1 items-end justify-between gap-4'>
          <div>
            <div
              className={cn(
                'font-rounded numeric text-[34px] leading-tight font-semibold',
                available < 0 && !hidden && 'text-red'
              )}
            >
              {format(available)}
            </div>
            <div className='text-footnote text-label-2'>disponível agora</div>
            {end !== undefined && (
              <div className='text-footnote mt-2'>
                <span className='text-label-2'>Em 30 dias </span>
                <span className={cn('numeric font-semibold', end < 0 && !hidden && 'text-red')}>
                  {format(end)}
                </span>
              </div>
            )}
            {negative && (
              <div className='text-footnote text-red mt-0.5 flex items-center gap-1 font-semibold'>
                <TrendingDown className='size-3.5' /> negativo em {shortDay(negative.date)}
              </div>
            )}
          </div>
          {days.length > 1 && (
            <div className='h-[72px] w-[46%] max-w-[260px]'>
              <ResponsiveContainer width='100%' height='100%'>
                <AreaChart data={days} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id='today-balance' x1='0' y1='0' x2='0' y2='1'>
                      <stop offset='0%' stopColor={color} stopOpacity={0.35} />
                      <stop offset='100%' stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis hide domain={['dataMin', 'dataMax']} />
                  <Area
                    type='monotone'
                    dataKey='totalCents'
                    stroke={color}
                    strokeWidth={2}
                    fill='url(#today-balance)'
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </Widget>
  );
}

function NextEventWidget({
  events,
  later,
}: {
  events: EventOccurrence[] | undefined;
  /** Próximo compromisso depois de hoje (quando hoje não tem mais nada). */
  later: EventOccurrence | null | undefined;
}) {
  const today = events ? nextUpcoming(events, new Date()) : undefined;
  const next = today ?? later ?? undefined;
  return (
    <Widget title='A seguir' icon={<CalendarDays />} color='var(--red)' to='/agenda'>
      {!events || (!today && later === undefined) ? (
        <Skeleton className='mt-2 h-14' />
      ) : next ? (
        <div className='mt-1 flex flex-1 gap-2.5'>
          <span
            className='w-[4px] shrink-0 rounded-full'
            style={{ backgroundColor: next.color ?? 'var(--red)' }}
          />
          <div className='min-w-0'>
            <div className='text-headline line-clamp-2'>{next.title}</div>
            <div className='text-footnote text-label-2 numeric mt-0.5'>
              {!today && (
                <span className='text-red font-semibold'>
                  {capitalize(relativeDay(eventDay(next)))}
                  {' · '}
                </span>
              )}
              {next.allDay ? 'Dia inteiro' : `${time(next.startAt)} – ${time(next.endAt)}`}
            </div>
            {next.location && (
              <div className='text-footnote text-label-2 mt-0.5 flex items-center gap-1 truncate'>
                <MapPin className='size-3 shrink-0' /> {next.location}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className='text-subhead text-label-2 mt-auto'>
          Nada na agenda pelos próximos meses.
        </div>
      )}
    </Widget>
  );
}

/** Linha "Próximo: qua., 22 de out. · 14:00" para quando o dia está vazio. */
function NextEventRow({ event, label }: { event: EventOccurrence; label: string }) {
  const key = eventDay(event);
  return (
    <Link to='/agenda' search={{ date: key }} className='block'>
      <Row
        chevron
        leading={
          <span className='bg-red/12 text-red flex size-[29px] flex-col items-center justify-center rounded-[7px] leading-none'>
            <span className='text-[13px] font-bold'>{Number(key.slice(8))}</span>
          </span>
        }
        title={
          <span className='flex items-center gap-2'>
            <span
              className='size-2 shrink-0 rounded-full'
              style={{ backgroundColor: event.color ?? 'var(--red)' }}
            />
            <span className='truncate'>{event.title}</span>
          </span>
        }
        subtitle={`${label}: ${relativeDay(key)}${event.allDay ? ', dia inteiro' : ` às ${time(event.startAt)}`}`}
      />
    </Link>
  );
}

function TasksWidget({ open }: { open: TaskResponse[] | undefined }) {
  const completed = useTasks({ view: 'completed' });
  const today = todayKey();
  const doneToday = (completed.data ?? []).filter(
    (t) => t.completedAt && dayKey(t.completedAt) === today
  ).length;
  const progress = taskProgress(doneToday, open?.length ?? 0);

  return (
    <Widget title='Tarefas' icon={<CircleCheck />} color='var(--orange)' to='/tarefas/hoje'>
      <div className='flex flex-1 items-center justify-between gap-2'>
        <div>
          <div className='font-rounded numeric text-[34px] leading-none font-semibold'>
            {doneToday}
            <span className='text-label-3 text-[22px]'>/{doneToday + (open?.length ?? 0)}</span>
          </div>
          <div className='text-footnote text-label-2 mt-1'>
            {progress >= 1 ? 'tudo feito' : 'feitas hoje'}
          </div>
        </div>
        <Ring value={progress} color='var(--orange)' size={68} />
      </div>
    </Widget>
  );
}

function TaskRow({ task, today }: { task: TaskResponse; today: string }) {
  const complete = useCompleteTask();
  const updateTx = useUpdateTransaction();
  const [checked, setChecked] = useState(false);
  const due = task.dueAt ? dayKey(task.dueAt) : null;
  const overdue = due !== null && due < today;
  const when =
    due === null
      ? 'Sem data'
      : overdue || due > today
        ? `${relativeDay(due)}${task.hasTime ? ` às ${time(task.dueAt!)}` : ''}`
        : task.hasTime
          ? time(task.dueAt!)
          : 'Hoje';

  return (
    <Row
      className={cn('transition-opacity duration-500', checked && 'opacity-40')}
      leading={
        <CheckCircle
          checked={checked}
          color='var(--orange)'
          label={`Concluir ${task.title}`}
          onChange={() => {
            setChecked(true);
            setTimeout(async () => {
              const result = await complete.mutateAsync(task.id);
              if (result.linkedPlannedTransactionId) {
                const txId = result.linkedPlannedTransactionId;
                toast('Tarefa concluída', {
                  description: 'A conta ligada ainda está prevista.',
                  action: {
                    label: 'Marcar como paga',
                    onClick: () => updateTx.mutate({ id: txId, status: 'DONE' }),
                  },
                });
              } else if (result.next?.dueAt) {
                toast(`Próxima: ${relativeDay(dayKey(result.next.dueAt))}`);
              }
            }, 450);
          }}
        />
      }
      title={task.title}
      subtitle={
        <span className={cn(overdue && 'text-red')}>
          {when}
          {task.tags.length > 0 && <span className='text-label-2'> · #{task.tags.join(' #')}</span>}
        </span>
      }
    />
  );
}

function BillRow({
  bill,
  onOpen,
  format,
}: {
  bill: TransactionResponse;
  onOpen: () => void;
  format: (cents: number) => string;
}) {
  const categories = useCategories();
  const update = useUpdateTransaction();
  const category = categories.data?.find((c) => c.id === bill.categoryId);
  const income = bill.kind === 'INCOME';
  const today = todayKey();

  return (
    <Row
      leading={<CategoryIcon category={category} kind={bill.kind} />}
      title={
        <button
          type='button'
          onClick={onOpen}
          className='block w-full truncate text-left active:opacity-60'
        >
          {bill.description}
        </button>
      }
      subtitle={
        <span className={cn(bill.date < today && 'text-red')}>
          {bill.date < today ? `Venceu ${relativeDay(bill.date).toLowerCase()}` : 'Vence hoje'}
        </span>
      }
      trailing={
        <div className='flex items-center gap-2'>
          {/* Conta ainda não paga: a cor da entrada ou saída, mais transparente. */}
          <span className={cn('numeric text-body', income ? 'text-green/60' : 'text-red/60')}>
            {format(bill.amountCents)}
          </span>
          <button
            type='button'
            onClick={(event) => {
              event.stopPropagation();
              update.mutate({ id: bill.id, status: 'DONE' });
            }}
            className='bg-tint/15 text-tint text-footnote rounded-full px-3 py-1 font-semibold active:opacity-60'
          >
            {income ? 'Receber' : 'Pagar'}
          </button>
        </div>
      }
    />
  );
}

export function TodayPage() {
  const me = useCurrentUser();
  const today = todayKey();
  const range = useMemo(() => {
    return {
      start: startOfDay(today),
      end: startOfDay(addDays(today, 1)),
      weekEnd: startOfDay(addDays(today, 8)),
    };
  }, [today]);
  const agenda = useAgenda(range.start, range.end);
  const week = useAgenda(range.end, range.weekEnd);
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [txSheet, setTxSheet] = useState<{ open: boolean; tx?: TransactionResponse }>({
    open: false,
  });

  const { hidden, toggle: toggleHidden, format } = useHiddenMoney();
  const upcomingTasks = useTasks({ view: 'next7' });
  const undatedTasks = useTasks({ view: 'nodate' });

  const data = agenda.data;
  const allDay = data?.events.filter((e) => e.allDay) ?? [];
  const timed = data?.events.filter((e) => !e.allDay) ?? [];
  const now = new Date();
  // Hoje não tem mais nada com horário pela frente: busca o próximo depois de hoje.
  const nothingLeft = !!data && !nextUpcoming(data.events, now);
  const later = useNextEvent(range.end, nothingLeft);
  const laterEvent = nothingLeft ? later.data?.event : undefined;
  const allPast = timed.length > 0 && allDay.length === 0 && nothingLeft;

  // Além das de hoje: até 3 dos próximos dias e até 3 sem data.
  const soonTasks = (upcomingTasks.data ?? [])
    .filter((task) => task.dueAt && dayKey(task.dueAt) > today)
    .slice(0, 3);
  const undated = sortUndated(undatedTasks.data ?? []).slice(0, 3);

  const upcomingDays = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of week.data?.events ?? []) {
      const key = event.allDay ? event.startAt.slice(0, 10) : dayKey(event.startAt);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 4);
  }, [week.data]);

  return (
    <Page
      title='Hoje'
      eyebrow={longDay(today)}
      actions={
        <>
          <SettingsButton />
          <BarButton label='Adicionar' onClick={() => setMenu(true)}>
            <Plus strokeWidth={2.4} />
          </BarButton>
        </>
      }
    >
      <p className='text-subhead text-label-2 -mt-2 mb-5'>
        {greeting(now.getHours())}, {me.name.split(' ')[0]}.
      </p>

      <BriefingCard format={format} />

      <div className='mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <BalanceWidget format={format} hidden={hidden} onToggleHidden={toggleHidden} />
        <NextEventWidget
          events={data?.events}
          later={
            !data
              ? undefined
              : nothingLeft
                ? later.isPending
                  ? undefined
                  : (laterEvent ?? null)
                : null
          }
        />
        <TasksWidget open={data?.tasks} />
      </div>

      <Section header='Agenda' action={<Link to='/agenda'>Ver agenda</Link>}>
        {!data ? (
          <div className='space-y-2 p-4'>
            <Skeleton className='h-10' />
            <Skeleton className='h-10' />
          </div>
        ) : data.events.length === 0 ? (
          <>
            <Row
              leading={<CalendarDays className='text-label-3 size-[22px]' />}
              title={<span className='text-label-2'>Nenhum compromisso hoje</span>}
            />
            {laterEvent && <NextEventRow event={laterEvent} label='Próximo' />}
          </>
        ) : (
          <>
            {allDay.map((event) => (
              <Link key={event.eventId + event.occurrenceStart} to='/agenda' className='block'>
                <Row
                  leading={
                    <span className='text-caption text-label-2 w-11 text-right font-medium'>
                      dia inteiro
                    </span>
                  }
                  title={
                    <span className='flex items-center gap-2'>
                      <span
                        className='size-2 shrink-0 rounded-full'
                        style={{ backgroundColor: event.color ?? 'var(--red)' }}
                      />
                      {event.title}
                    </span>
                  }
                />
              </Link>
            ))}
            {timed.map((event) => {
              const past = new Date(event.endAt) < now;
              const live = new Date(event.startAt) <= now && !past;
              return (
                <Link key={event.eventId + event.occurrenceStart} to='/agenda' className='block'>
                  <Row
                    className={cn(past && 'opacity-50')}
                    leading={
                      <div className='numeric w-11 text-right leading-tight'>
                        <div className='text-subhead font-semibold'>{time(event.startAt)}</div>
                        <div className='text-caption text-label-2'>{time(event.endAt)}</div>
                      </div>
                    }
                    title={
                      <span className='flex items-center gap-2.5'>
                        <span
                          className='h-9 w-[3px] shrink-0 rounded-full'
                          style={{ backgroundColor: event.color ?? 'var(--red)' }}
                        />
                        <span className='min-w-0'>
                          <span className='block truncate'>{event.title}</span>
                          {(event.location || live) && (
                            <span className='text-footnote text-label-2 block truncate'>
                              {live && <span className='text-red font-semibold'>Agora · </span>}
                              {event.location}
                            </span>
                          )}
                        </span>
                      </span>
                    }
                  />
                </Link>
              );
            })}
            {allPast && laterEvent && <NextEventRow event={laterEvent} label='Depois de hoje' />}
          </>
        )}
      </Section>

      <Section header='Tarefas' action={<Link to='/tarefas'>Ver todas</Link>}>
        {!data ? (
          <div className='p-4'>
            <Skeleton className='h-10' />
          </div>
        ) : (
          <>
            {data.tasks.length === 0 ? (
              <Row
                leading={<CircleCheck className='text-orange size-[22px]' />}
                title={
                  <span className='text-label-2'>
                    {soonTasks.length || undated.length ? 'Nada para hoje' : 'Tudo em dia'}
                  </span>
                }
              />
            ) : (
              data.tasks.map((task) => <TaskRow key={task.id} task={task} today={today} />)
            )}
            {soonTasks.length > 0 && (
              <>
                <TaskGroupLabel>Em breve</TaskGroupLabel>
                {soonTasks.map((task) => (
                  <TaskRow key={task.id} task={task} today={today} />
                ))}
              </>
            )}
            {undated.length > 0 && (
              <>
                <TaskGroupLabel>Sem data</TaskGroupLabel>
                {undated.map((task) => (
                  <TaskRow key={task.id} task={task} today={today} />
                ))}
              </>
            )}
          </>
        )}
      </Section>

      {data && (data.bills.length > 0 || data.invoices.length > 0) && (
        <Section header='Contas do dia'>
          {data.invoices.map((invoice) => (
            <Link
              key={invoice.invoiceId}
              to='/financas/contas/$accountId'
              params={{ accountId: invoice.accountId }}
              className='block'
            >
              <Row
                chevron
                leading={
                  <span className='bg-indigo flex size-[29px] items-center justify-center rounded-full text-white'>
                    <CreditCard className='size-4' />
                  </span>
                }
                title={`Fatura ${invoice.accountName}`}
                subtitle={
                  <span className={cn(invoice.dueDate < today && 'text-red')}>
                    {invoice.dueDate < today ? 'Vencida' : 'Vence hoje'}
                  </span>
                }
                detail={format(invoice.totalCents)}
              />
            </Link>
          ))}
          {data.bills.map((bill) => (
            <BillRow
              key={bill.id}
              bill={bill}
              format={format}
              onOpen={() => setTxSheet({ open: true, tx: bill })}
            />
          ))}
        </Section>
      )}

      {week.data && (upcomingDays.length > 0 || week.data.bills.length > 0) && (
        <Section header='Próximos dias'>
          {upcomingDays.map(([key, count]) => (
            <Link key={key} to='/agenda' search={{ date: key }} className='block'>
              <Row
                chevron
                leading={
                  <span className='bg-red/12 text-red flex size-[29px] flex-col items-center justify-center rounded-[7px] leading-none'>
                    <span className='text-[13px] font-bold'>{Number(key.slice(8))}</span>
                  </span>
                }
                title={capitalize(relativeDay(key, today))}
                detail={`${count} ${count === 1 ? 'evento' : 'eventos'}`}
              />
            </Link>
          ))}
          {week.data.bills.length > 0 && (
            <Link to='/financas' search={{ tab: 'previsao' }} className='block'>
              <Row
                chevron
                leading={
                  <span className='bg-green/15 text-green flex size-[29px] items-center justify-center rounded-[7px]'>
                    <Receipt className='size-4' />
                  </span>
                }
                title='Contas na semana'
                detail={format(
                  week.data.bills
                    .filter((b) => b.kind === 'EXPENSE')
                    .reduce((sum, b) => sum + b.amountCents, 0)
                )}
              />
            </Link>
          )}
        </Section>
      )}

      {data && data.events.length === 0 && data.tasks.length === 0 && data.bills.length === 0 && (
        <EmptyState
          icon={<CalendarDays />}
          title='Um dia livre'
          message='Nada marcado, nenhuma tarefa e nenhuma conta para hoje.'
        />
      )}

      <ActionSheet
        open={menu}
        onOpenChange={setMenu}
        actions={[
          {
            label: 'Novo evento',
            onSelect: () => void navigate({ to: '/agenda', search: { novo: '1' } }),
          },
          {
            label: 'Nova tarefa',
            onSelect: () =>
              void navigate({
                to: '/tarefas',
                search: { filtro: 'hoje', novo: '1' },
              }),
          },
          { label: 'Novo lançamento', onSelect: () => setTxSheet({ open: true }) },
        ]}
      />
      <InstallInvite />
      <TransactionSheet
        open={txSheet.open}
        onOpenChange={(open) => setTxSheet((s) => ({ ...s, open }))}
        transaction={txSheet.tx}
      />
    </Page>
  );
}
