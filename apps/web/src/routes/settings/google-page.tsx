import { useNavigate } from '@tanstack/react-router';
import { CalendarDays, ChevronLeft, CircleCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button, Spinner, Switch } from '@/components/ios/controls';
import { SelectInput } from '@/components/ios/fields';
import { IconChip, Row, Section } from '@/components/ios/list';
import { BarButton, Page } from '@/components/ios/page';
import { ActionSheet } from '@/components/ios/sheet';
import {
  startGoogle,
  useDisconnectGoogle,
  useGoogleStatus,
  useSyncGoogle,
  useUpdateGoogleCalendars,
} from '@/features/google';

import { GoogleGlyph } from './settings-page';

function ago(iso: string | null) {
  if (!iso) return 'nunca';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function GooglePage() {
  const navigate = useNavigate();
  const status = useGoogleStatus();
  const update = useUpdateGoogleCalendars();
  const sync = useSyncGoogle();
  const disconnect = useDisconnectGoogle();
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'ok') toast.success('Conta Google conectada. Sincronizando…');
    if (params.get('erro')) toast.error('Não deu para conectar o Google. Tente de novo.');
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
      ) : !data.configured ? (
        <Section footer='Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET na API (veja docs/deploy/railway.md).'>
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
          <span className='bg-background mb-4 flex size-16 items-center justify-center rounded-[18px]'>
            <GoogleGlyph className='size-9' />
          </span>
          <h2 className='text-title-2'>Conectar ao Google</h2>
          <p className='text-subhead text-label-2 mt-2 max-w-sm'>
            Seus compromissos do Google Agenda aparecem aqui e o que você criar no Jottape vai para
            lá. As listas do Google Tasks viram listas de tarefas, nos dois sentidos.
          </p>
          <Button className='mt-6 w-full max-w-xs' onClick={() => startGoogle('connect')}>
            Conectar conta Google
          </Button>
        </div>
      ) : (
        <>
          <Section>
            <Row
              leading={
                <IconChip color='#ffffff'>
                  <GoogleGlyph />
                </IconChip>
              }
              title={data.email}
              subtitle='Conta conectada'
            />
          </Section>

          {data.lastError && (
            <div className='bg-red/12 text-red text-subhead mb-7 flex gap-3 rounded-[var(--radius)] p-4'>
              <TriangleAlert className='size-5 shrink-0' />
              <div>
                <div className='font-semibold'>A sincronização falhou</div>
                <div className='opacity-90'>{data.lastError}</div>
                <button
                  type='button'
                  className='mt-2 font-semibold underline'
                  onClick={() => startGoogle('connect')}
                >
                  Conectar de novo
                </button>
              </div>
            </div>
          )}

          <Section
            header='Calendários'
            footer='Os calendários ligados aparecem na Agenda. Eventos novos vão para o calendário padrão.'
          >
            {data.calendars.map((calendar) => (
              <Row
                key={calendar.id}
                leading={
                  <span
                    className='size-3 rounded-full'
                    style={{ backgroundColor: calendar.color ?? 'var(--blue)' }}
                  />
                }
                title={calendar.name}
                subtitle={calendar.selected ? `Sincronizado ${ago(calendar.syncedAt)}` : undefined}
                trailing={
                  <Switch
                    label={calendar.name}
                    checked={calendar.selected}
                    onChange={(on) =>
                      update.mutate({
                        selectedIds: data.calendars
                          .filter((c) => (c.id === calendar.id ? on : c.selected))
                          .map((c) => c.id),
                        defaultCalendarId: data.defaultCalendarId,
                      })
                    }
                  />
                }
              />
            ))}
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
                    update.mutate({
                      selectedIds: data.calendars.filter((c) => c.selected).map((c) => c.id),
                      defaultCalendarId: value || null,
                    })
                  }
                  placeholder='Só no Jottape'
                  options={data.calendars.map((c) => ({ value: c.id, label: c.name }))}
                />
              }
            />
          </Section>

          <Section
            header='Tarefas'
            footer='O Google Tasks guarda só o dia do prazo; hora, repetição e lembretes ficam no Jottape.'
          >
            <Row
              leading={
                <IconChip color='var(--blue)'>
                  <CircleCheck />
                </IconChip>
              }
              title='Google Tasks'
              detail={ago(data.tasksSyncedAt)}
            />
          </Section>

          <Section>
            <Row destructive title='Desconectar conta Google' onClick={() => setConfirm(true)} />
          </Section>

          <ActionSheet
            open={confirm}
            onOpenChange={setConfirm}
            title='Desconectar o Google?'
            message='Os eventos do Google somem da Agenda. Suas tarefas ficam no Jottape.'
            actions={[
              { label: 'Desconectar', destructive: true, onSelect: () => disconnect.mutate() },
            ]}
          />
        </>
      )}
    </Page>
  );
}
