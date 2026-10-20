import type { GoogleAccountResponse, GoogleCalendarResponse } from '@jottape/schemas';
import { useNavigate } from '@tanstack/react-router';
import {
  CalendarDays,
  ChevronLeft,
  CircleCheck,
  Plus,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button, Spinner, Switch } from '@/components/ios/controls';
import { ColorPicker, SelectInput } from '@/components/ios/fields';
import { IconChip, Row, Section } from '@/components/ios/list';
import { BarButton, Page } from '@/components/ios/page';
import { ActionSheet, Sheet } from '@/components/ios/sheet';
import {
  alsoInLabel,
  calendarsBody,
  PROVIDER_NAME,
  reconnect,
  startGoogle,
  startMicrosoft,
  useDisconnectGoogleAccount,
  useGoogleStatus,
  useSetTasksAccount,
  useSyncGoogle,
  useSyncGoogleAccount,
  useUpdateGoogleCalendars,
} from '@/features/google';
import { cn } from '@/lib/utils';

import { GoogleGlyph, MicrosoftGlyph } from './settings-page';

function ago(iso: string | null) {
  if (!iso) return 'nunca';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

const ERRORS: Record<string, string> = {
  'conta-em-uso': 'Essa conta Google já está ligada a outro usuário do Jottape.',
};

export function GooglePage() {
  const navigate = useNavigate();
  const status = useGoogleStatus();
  const update = useUpdateGoogleCalendars();
  const sync = useSyncGoogle();
  const syncAccount = useSyncGoogleAccount();
  const disconnect = useDisconnectGoogleAccount();
  const setTasksAccount = useSetTasksAccount();
  const [disconnecting, setDisconnecting] = useState<GoogleAccountResponse | null>(null);
  const [tasksTarget, setTasksTarget] = useState<string | null | undefined>(undefined);
  const [painting, setPainting] = useState<GoogleCalendarResponse | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'ok') toast.success('Conta Google conectada. Sincronizando…');
    if (params.get('microsoft') === 'ok')
      toast.success('Conta da Microsoft conectada. Sincronizando…');
    const error = params.get('erro');
    if (error)
      toast.error(
        ERRORS[error] ??
          `Não deu para conectar ${error === 'microsoft' ? 'a Microsoft' : 'o Google'}. Tente de novo.`
      );
    if (params.size) window.history.replaceState(null, '', window.location.pathname);
  }, []);

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

  const data = status.data;
  const emailOf = (accountId: string | null | undefined) =>
    data?.accounts.find((a) => a.id === accountId)?.email;

  return (
    <Page
      title='Google'
      leading={back}
      actions={
        data?.connected && (
          <BarButton
            label='Sincronizar agora'
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            {sync.isPending ? <Spinner /> : <RefreshCw />}
          </BarButton>
        )
      }
    >
      {!data ? (
        <div className='text-label-2 flex justify-center py-16'>
          <Spinner />
        </div>
      ) : !data.configured && !data.microsoftConfigured ? (
        <Section footer='Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (ou MICROSOFT_CLIENT_ID e MICROSOFT_CLIENT_SECRET) na API (veja docs/deploy/railway.md).'>
          <Row
            leading={
              <IconChip color='var(--orange)'>
                <TriangleAlert />
              </IconChip>
            }
            title='Google não configurado no servidor'
          />
        </Section>
      ) : !data.connected ? (
        <div className='bg-surface flex flex-col items-center rounded-[var(--radius)] px-6 py-8 text-center'>
          <span className='mb-4 flex gap-3'>
            {data.configured && (
              <span className='bg-background flex size-16 items-center justify-center rounded-[18px]'>
                <GoogleGlyph className='size-9' />
              </span>
            )}
            {data.microsoftConfigured && (
              <span className='bg-background flex size-16 items-center justify-center rounded-[18px]'>
                <MicrosoftGlyph className='size-8' />
              </span>
            )}
          </span>
          <h2 className='text-title-2'>Conectar suas agendas</h2>
          <p className='text-subhead text-label-2 mt-2 max-w-sm'>
            Seus compromissos do Google Agenda{data.microsoftConfigured && ' e do Outlook'} aparecem
            aqui e o que você criar no Jottape vai para lá.
            {data.configured &&
              ' As listas do Google Tasks viram listas de tarefas, nos dois sentidos.'}{' '}
            Dá para conectar mais de uma conta.
          </p>
          {data.configured && (
            <Button className='mt-6 w-full max-w-xs' onClick={() => startGoogle('connect')}>
              Conectar conta Google
            </Button>
          )}
          {data.microsoftConfigured && (
            <Button
              variant={data.configured ? 'gray' : 'filled'}
              className={cn('w-full max-w-xs', data.configured ? 'mt-3' : 'mt-6')}
              onClick={startMicrosoft}
            >
              Conectar conta Microsoft
            </Button>
          )}
        </div>
      ) : (
        <>
          {data.accounts.map((account) => {
            const calendars = data.calendars.filter((c) => c.accountId === account.id);
            return (
              <Section
                key={account.id}
                header={`${account.email} · ${PROVIDER_NAME[account.provider]}`}
              >
                {account.lastError && (
                  <Row
                    leading={
                      <IconChip color='var(--red)'>
                        <TriangleAlert />
                      </IconChip>
                    }
                    title='A sincronização falhou'
                    subtitle={account.lastError}
                    detail={
                      account.needsReconnect ? (
                        'Reconectar'
                      ) : syncAccount.isPending && syncAccount.variables === account.id ? (
                        <Spinner />
                      ) : (
                        'Tentar de novo'
                      )
                    }
                    onClick={() =>
                      account.needsReconnect ? reconnect(account) : syncAccount.mutate(account.id)
                    }
                  />
                )}
                {calendars.map((calendar) => (
                  <Row
                    key={calendar.id}
                    leading={
                      <button
                        type='button'
                        aria-label={`Cor de ${calendar.name}`}
                        onClick={() => setPainting(calendar)}
                        className='flex size-7 items-center justify-center active:opacity-40'
                      >
                        <span
                          className='size-3 rounded-full'
                          style={{ backgroundColor: calendar.color ?? 'var(--blue)' }}
                        />
                      </button>
                    }
                    title={calendar.name}
                    subtitle={
                      alsoInLabel(data, calendar) ??
                      (calendar.selected ? `Sincronizado ${ago(calendar.syncedAt)}` : undefined)
                    }
                    trailing={
                      <Switch
                        label={calendar.name}
                        checked={calendar.selected}
                        onChange={(on) =>
                          update.mutate(calendarsBody(data, { selected: { id: calendar.id, on } }))
                        }
                      />
                    }
                  />
                ))}
                <Row
                  destructive
                  title='Desconectar esta conta'
                  onClick={() => setDisconnecting(account)}
                />
              </Section>
            );
          })}

          <Section>
            {data.configured && (
              <Row
                leading={
                  <IconChip color='var(--blue)'>
                    <Plus />
                  </IconChip>
                }
                action
                title='Adicionar conta Google'
                onClick={() => startGoogle('connect')}
              />
            )}
            {data.microsoftConfigured && (
              <Row
                leading={
                  <IconChip color='var(--blue)'>
                    <Plus />
                  </IconChip>
                }
                action
                title='Adicionar conta Microsoft'
                onClick={startMicrosoft}
              />
            )}
          </Section>

          <Section footer='Os calendários ligados aparecem na Agenda. Eventos novos vão para o calendário padrão.'>
            <Row
              leading={
                <IconChip color='var(--red)'>
                  <CalendarDays />
                </IconChip>
              }
              title='Calendário padrão'
              trailing={
                <SelectInput
                  value={data.defaultCalendarId ?? ''}
                  onChange={(value) =>
                    update.mutate(calendarsBody(data, { defaultCalendarId: value || null }))
                  }
                  placeholder='Só no Jottape'
                  options={data.calendars.map((c) => ({
                    value: c.id,
                    label: c.name,
                    group: emailOf(c.accountId),
                  }))}
                />
              }
            />
          </Section>

          {data.configured && (
            <Section
              header='Google Tasks'
              footer={
                data.tasksAccountId
                  ? `Sincronizado ${ago(data.tasksSyncedAt)}. O Google Tasks guarda só o dia do prazo; hora, repetição e lembretes ficam no Jottape.`
                  : 'As tarefas ficam só no Jottape.'
              }
            >
              <Row
                leading={
                  <IconChip color='var(--blue)'>
                    <CircleCheck />
                  </IconChip>
                }
                title='Conta'
                trailing={
                  setTasksAccount.isPending ? (
                    <Spinner />
                  ) : (
                    <SelectInput
                      value={data.tasksAccountId ?? ''}
                      onChange={(value) => setTasksTarget(value || null)}
                      placeholder='Nenhuma'
                      options={data.accounts
                        .filter((a) => a.provider === 'GOOGLE')
                        .map((a) => ({ value: a.id, label: a.email }))}
                    />
                  )
                }
              />
            </Section>
          )}

          <ActionSheet
            open={Boolean(disconnecting)}
            onOpenChange={(open) => !open && setDisconnecting(null)}
            title={`Desconectar ${disconnecting?.email ?? ''}?`}
            message={
              disconnecting?.syncTasks
                ? 'Os eventos desta conta somem da Agenda e as tarefas param de sincronizar com o Google Tasks. Suas tarefas ficam no Jottape.'
                : 'Os eventos desta conta somem da Agenda. As outras contas continuam conectadas.'
            }
            actions={[
              {
                label: 'Desconectar',
                destructive: true,
                onSelect: () => disconnecting && disconnect.mutate(disconnecting.id),
              },
            ]}
          />

          <ActionSheet
            open={tasksTarget !== undefined}
            onOpenChange={(open) => !open && setTasksTarget(undefined)}
            title={
              tasksTarget
                ? `Sincronizar tarefas com ${emailOf(tasksTarget)}?`
                : 'Parar de sincronizar as tarefas?'
            }
            message={
              tasksTarget
                ? 'As tarefas e listas do Jottape são enviadas para esta conta, e as dela aparecem aqui. Nada some da conta anterior.'
                : 'Suas tarefas ficam no Jottape, sem ligação com o Google Tasks.'
            }
            actions={[
              {
                label: tasksTarget ? 'Sincronizar' : 'Parar',
                destructive: !tasksTarget,
                onSelect: () =>
                  tasksTarget !== undefined && setTasksAccount.mutate({ accountId: tasksTarget }),
              },
            ]}
          />

          <Sheet
            open={Boolean(painting)}
            onOpenChange={(open) => !open && setPainting(null)}
            title={painting?.name ?? 'Cor'}
            cancelLabel='OK'
          >
            <Section footer='A cor vale só no Jottape; no Google fica a de lá.'>
              <ColorPicker
                value={painting?.colorOverride ?? null}
                onChange={(color) => {
                  if (!painting) return;
                  update.mutate(calendarsBody(data, { color: { id: painting.id, color } }));
                  setPainting(null);
                }}
              />
              {painting?.colorOverride && (
                <Row
                  action
                  title='Usar a cor do Google'
                  onClick={() => {
                    update.mutate(calendarsBody(data, { color: { id: painting.id, color: null } }));
                    setPainting(null);
                  }}
                />
              )}
            </Section>
          </Sheet>
        </>
      )}
    </Page>
  );
}
