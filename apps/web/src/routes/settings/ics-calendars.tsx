import type { GoogleCalendarResponse, GoogleStatusResponse } from '@jottape/schemas';
import { Info, Link2, Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Spinner } from '@/components/ios/controls';
import { ColorPicker, FieldRow, TextArea, TextInput } from '@/components/ios/fields';
import { IconChip, Row, Section } from '@/components/ios/list';
import { ActionSheet, Sheet } from '@/components/ios/sheet';
import {
  linkSourceName,
  useAddIcsCalendar,
  useDisconnectGoogleAccount,
  useSyncGoogleAccount,
  useUpdateIcsCalendar,
} from '@/features/google';
import { useFormErrors } from '@/lib/use-form-errors';

// Agendas por link (ICS/webcal): a agenda do trabalho publicada pelo Outlook quando a TI não deixa
// conectar a conta. Só de leitura; o link é segredo e, depois de salvo, não volta para o app.

export function ago(iso: string | null) {
  if (!iso) return 'nunca';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

const OUTLOOK_STEPS = [
  {
    title: 'Abra o Outlook na web',
    text: 'Em outlook.office.com, vá em Configurações › Calendário › Calendários compartilhados.',
  },
  {
    title: 'Publique o calendário',
    text: 'Em "Publicar um calendário", escolha o calendário e "Pode ver todos os detalhes", e toque em Publicar.',
  },
  {
    title: 'Copie o link ICS',
    text: 'E cole aqui em cima. Link .ics ou webcal de outro lugar (Google, iCloud) também serve.',
  },
];

export function IcsSection({
  data,
  onPaint,
}: {
  data: GoogleStatusResponse;
  onPaint: (calendar: GoogleCalendarResponse) => void;
}) {
  const [editing, setEditing] = useState<GoogleCalendarResponse | 'new' | null>(null);
  const accounts = data.accounts.filter((a) => a.provider === 'ICS');
  const calendars = data.calendars.filter((c) => accounts.some((a) => a.id === c.accountId));

  return (
    <>
      <Section
        header='Agendas por link'
        footer={
          calendars.length
            ? 'Só de leitura: os eventos aparecem na Agenda e no briefing e são lidos de novo a cada 5 minutos.'
            : 'Para a agenda do trabalho que a TI não deixa conectar: publique no Outlook e cole o link ICS.'
        }
      >
        {calendars.map((calendar) => {
          const account = accounts.find((a) => a.id === calendar.accountId);
          return (
            <Row
              key={calendar.id}
              leading={
                <button
                  type='button'
                  aria-label={`Cor de ${calendar.name}`}
                  onClick={() => onPaint(calendar)}
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
                account?.lastError ? (
                  <span className='text-red'>{account.lastError}</span>
                ) : (
                  `${linkSourceName(account?.email ?? '')} · ${calendar.selected ? `lido ${ago(calendar.syncedAt)}` : 'escondida na Agenda'}`
                )
              }
              wrapSubtitle={Boolean(account?.lastError)}
              trailing={
                <button
                  type='button'
                  aria-label={`Ajustes de ${calendar.name}`}
                  onClick={() => setEditing(calendar)}
                  className='text-tint -mr-1 flex size-8 items-center justify-center active:opacity-40'
                >
                  <Info className='size-[22px]' />
                </button>
              }
            />
          );
        })}
        <Row
          leading={
            <IconChip color='var(--indigo)'>{calendars.length ? <Plus /> : <Link2 />}</IconChip>
          }
          action
          title='Adicionar agenda por link'
          onClick={() => setEditing('new')}
        />
      </Section>

      <IcsSheet
        key={editing === 'new' ? 'new' : (editing?.id ?? 'none')}
        data={data}
        target={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function IcsSheet({
  data,
  target,
  onClose,
}: {
  data: GoogleStatusResponse;
  target: GoogleCalendarResponse | 'new' | null;
  onClose: () => void;
}) {
  const creating = target === 'new';
  const calendar = target && target !== 'new' ? target : null;
  const account = calendar ? data.accounts.find((a) => a.id === calendar.accountId) : null;
  const add = useAddIcsCalendar();
  const save = useUpdateIcsCalendar();
  const sync = useSyncGoogleAccount();
  const remove = useDisconnectGoogleAccount();
  const [name, setName] = useState(calendar?.name ?? '');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const { errors, validate } = useFormErrors({
    url: creating && !url.trim() && 'Cole o link da agenda.',
    name: !creating && !name.trim() && 'Dê um nome.',
  });
  const pending = add.isPending || save.isPending;

  async function submit() {
    if (!validate()) return;
    try {
      if (creating) {
        const status = await add.mutateAsync({
          url: url.trim(),
          name: name.trim() || null,
          color,
        });
        const added = status.calendars.at(-1);
        toast.success(`${added?.name ?? 'Agenda'} adicionada.`);
      } else if (calendar) {
        await save.mutateAsync({
          id: calendar.accountId,
          ...(name.trim() !== calendar.name ? { name: name.trim() } : {}),
          ...(url.trim() ? { url: url.trim() } : {}),
        });
        toast.success(url.trim() ? 'Link trocado.' : 'Agenda salva.');
      }
      onClose();
    } catch {
      // O erro já aparece no aviso (query-client).
    }
  }

  return (
    <>
      <Sheet
        open={Boolean(target)}
        onOpenChange={(open) => !open && onClose()}
        title={creating ? 'Agenda por link' : (calendar?.name ?? '')}
        confirmLabel={pending ? 'Lendo…' : creating ? 'Adicionar' : 'Salvar'}
        confirmDisabled={pending}
        onConfirm={submit}
      >
        <Section
          header={creating ? 'Link da agenda' : 'Trocar o link'}
          footer={
            creating
              ? 'O link fica cifrado no servidor e não aparece de novo no app: quem tem o link vê a agenda.'
              : `O link atual (${account?.email}) fica guardado e não é mostrado. Cole um novo só se a agenda for publicada de novo.`
          }
        >
          <FieldRow error={errors.url}>
            <TextArea
              rows={creating ? 3 : 2}
              inputMode='url'
              autoComplete='off'
              autoCapitalize='off'
              autoCorrect='off'
              spellCheck={false}
              placeholder={creating ? 'webcal://… ou https://….ics' : 'colar um link novo'}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className='break-all'
            />
          </FieldRow>
        </Section>

        <Section>
          <FieldRow label='Nome' error={errors.name}>
            <TextInput
              align='right'
              placeholder={creating ? 'o do Outlook' : 'Nome'}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FieldRow>
        </Section>

        {creating ? (
          <>
            <Section header='Cor'>
              <ColorPicker value={color} onChange={setColor} />
            </Section>
            <Section
              header='Como pegar o link no Outlook'
              footer='Se a empresa bloquear a publicação, a opção não aparece no Outlook; aí só a TI libera.'
            >
              {OUTLOOK_STEPS.map((step, index) => (
                <Row
                  key={step.title}
                  leading={
                    <span className='bg-tint font-rounded flex size-[29px] items-center justify-center rounded-full text-[15px] font-semibold text-white'>
                      {index + 1}
                    </span>
                  }
                  title={step.title}
                  subtitle={step.text}
                  wrapSubtitle
                />
              ))}
            </Section>
          </>
        ) : (
          account && (
            <Section>
              {account.lastError && (
                <Row
                  leading={
                    <IconChip color='var(--red)'>
                      <TriangleAlert />
                    </IconChip>
                  }
                  title='A leitura falhou'
                  subtitle={account.lastError}
                  wrapSubtitle
                />
              )}
              <Row
                leading={
                  <IconChip color='var(--blue)'>
                    <RefreshCw />
                  </IconChip>
                }
                action
                title='Ler agora'
                detail={sync.isPending ? <Spinner /> : `lido ${ago(calendar?.syncedAt ?? null)}`}
                onClick={() => sync.mutate(account.id)}
              />
              <Row destructive title='Remover agenda' onClick={() => setRemoving(true)} />
            </Section>
          )
        )}
      </Sheet>

      <ActionSheet
        open={removing}
        onOpenChange={setRemoving}
        title={`Remover ${calendar?.name ?? ''}?`}
        message='Os eventos dela somem da Agenda. Nada muda no Outlook.'
        actions={[
          {
            label: 'Remover',
            destructive: true,
            onSelect: () =>
              account &&
              remove.mutate(account.id, {
                onSuccess: () => {
                  toast.success('Agenda removida.');
                  onClose();
                },
              }),
          },
        ]}
      />
    </>
  );
}
