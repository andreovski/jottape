import { Link } from '@tanstack/react-router';
import {
  Bell,
  CalendarSync,
  Download,
  FileSpreadsheet,
  Globe,
  KeyRound,
  LogOut,
  Moon,
  Newspaper,
  Server,
  Shapes,
  Share,
  SquarePlus,
  Sunrise,
  Timer,
  User,
  Wallet,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { toast } from 'sonner';

import { Segmented, Spinner, Switch } from '@/components/ios/controls';
import { FieldRow, SelectInput, TextInput } from '@/components/ios/fields';
import { IconChip, Row, Section } from '@/components/ios/list';
import { Page } from '@/components/ios/page';
import { Sheet } from '@/components/ios/sheet';
import { useChangePassword, useLogout, useMe, useUpdateProfile } from '@/features/auth';
import { useGoogleStatus } from '@/features/google';
import { useApiHealth } from '@/features/health';
import { isStandalone, usePush } from '@/features/push';
import { errorMessage } from '@/lib/api';
import { useFormErrors } from '@/lib/use-form-errors';

import { REMINDER_OPTIONS, SUMMARY_OPTIONS, TIMEZONES } from './options';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export function SettingsPage() {
  const me = useMe().data!;
  const update = useUpdateProfile();
  const logout = useLogout();
  const google = useGoogleStatus();
  const health = useApiHealth();
  const push = usePush();
  const { theme = 'system', setTheme } = useTheme();
  const [sheet, setSheet] = useState<'profile' | 'password' | null>(null);

  async function togglePush(on: boolean) {
    try {
      if (on) {
        await push.enable();
        toast.success('Notificações ativadas neste aparelho.');
      } else {
        await push.disable();
      }
    } catch (error) {
      toast.error(
        error instanceof Error && !('response' in error) ? error.message : await errorMessage(error)
      );
    }
  }

  const googleDetail = google.data?.connected
    ? 'Conectado'
    : google.data?.configured
      ? 'Desligado'
      : '—';

  return (
    <Page title='Ajustes'>
      <Section>
        <Row
          onClick={() => setSheet('profile')}
          chevron
          leading={
            <span className='font-rounded flex size-[60px] items-center justify-center rounded-full bg-gradient-to-b from-[#a5a5ab] to-[#86868b] text-[24px] font-semibold text-white'>
              {initials(me.name)}
            </span>
          }
          title={<span className='text-title-3'>{me.name}</span>}
          subtitle={me.email}
        />
      </Section>

      <Section>
        <Row
          leading={
            <IconChip color='var(--red)'>
              <Bell />
            </IconChip>
          }
          title='Notificações'
          subtitle={
            !push.supported
              ? 'Este navegador não recebe notificações'
              : !push.configured
                ? 'Desligadas no servidor'
                : undefined
          }
          trailing={
            push.busy ? (
              <Spinner className='text-label-2' />
            ) : (
              <Switch
                label='Notificações neste aparelho'
                checked={push.subscribed}
                disabled={!push.supported || !push.configured}
                onChange={togglePush}
              />
            )
          }
        />
        <Row
          leading={
            <IconChip color='var(--orange)'>
              <Timer />
            </IconChip>
          }
          title='Alerta padrão'
          trailing={
            <SelectInput
              value={me.defaultReminderMin === null ? '' : String(me.defaultReminderMin)}
              onChange={(value) =>
                update.mutate({ defaultReminderMin: value === '' ? null : Number(value) })
              }
              options={REMINDER_OPTIONS}
              placeholder='Nenhum'
            />
          }
        />
        <Row
          leading={
            <IconChip color='var(--indigo)'>
              <Sunrise />
            </IconChip>
          }
          title='Resumo do dia'
          trailing={
            <SelectInput
              value={me.dailySummaryHour === null ? '' : String(me.dailySummaryHour)}
              onChange={(value) =>
                update.mutate({ dailySummaryHour: value === '' ? null : Number(value) })
              }
              options={SUMMARY_OPTIONS}
              placeholder='Desligado'
            />
          }
        />
        {push.subscribed && (
          <Row
            action
            title='Enviar notificação de teste'
            onClick={async () => {
              const { delivered } = await push.test();
              toast(delivered ? 'Enviada. Deve chegar em instantes.' : 'Nenhum aparelho recebeu.');
            }}
          />
        )}
      </Section>

      <Section>
        <Link to='/ajustes/google' className='block'>
          <Row
            chevron
            leading={
              <IconChip color='#ffffff'>
                <GoogleGlyph />
              </IconChip>
            }
            title='Google'
            subtitle='Calendário, Tarefas e login'
            detail={googleDetail}
          />
        </Link>
        <Link to='/ajustes/briefing' className='block'>
          <Row
            chevron
            leading={
              <IconChip color='var(--indigo)'>
                <Newspaper />
              </IconChip>
            }
            title='Briefing'
            subtitle='O que aparece no topo da tela Hoje'
          />
        </Link>
        <Link to='/ajustes/categorias' className='block'>
          <Row
            chevron
            leading={
              <IconChip color='var(--purple)'>
                <Shapes />
              </IconChip>
            }
            title='Categorias'
          />
        </Link>
        <Link to='/financas' className='block'>
          <Row
            chevron
            leading={
              <IconChip color='var(--green)'>
                <Wallet />
              </IconChip>
            }
            title='Contas e cartões'
          />
        </Link>
      </Section>

      <Section header='Aparência'>
        <div className='flex items-center gap-3 py-2 pr-4 pl-4'>
          <IconChip color='var(--blue)'>
            <Moon />
          </IconChip>
          <Segmented
            className='flex-1'
            value={theme as 'system' | 'light' | 'dark'}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'Automático' },
              { value: 'light', label: 'Claro' },
              { value: 'dark', label: 'Escuro' },
            ]}
          />
        </div>
      </Section>

      <Section>
        <Row
          onClick={() => setSheet('password')}
          chevron
          leading={
            <IconChip color='var(--gray)'>
              <KeyRound />
            </IconChip>
          }
          title={me.hasPassword ? 'Alterar senha' : 'Criar senha'}
        />
        <a href='/api/export?format=json' className='block'>
          <Row
            leading={
              <IconChip color='var(--teal)'>
                <Download />
              </IconChip>
            }
            title='Exportar todos os dados'
            subtitle='Arquivo JSON com tudo'
          />
        </a>
        <a href='/api/export?format=csv' className='block'>
          <Row
            leading={
              <IconChip color='var(--green)'>
                <FileSpreadsheet />
              </IconChip>
            }
            title='Exportar lançamentos'
            subtitle='Planilha CSV (Excel, Numbers, Sheets)'
          />
        </a>
      </Section>

      {!isStandalone() && (
        <Section
          header='Instalar no iPhone'
          footer='No app instalado as notificações funcionam e o Jottape abre em tela cheia, como um app da App Store.'
        >
          <Row
            leading={
              <IconChip color='var(--blue)'>
                <Share />
              </IconChip>
            }
            title='Toque em Compartilhar'
            subtitle='No Safari, na barra de baixo'
          />
          <Row
            leading={
              <IconChip color='var(--gray)'>
                <SquarePlus />
              </IconChip>
            }
            title='Adicionar à Tela de Início'
          />
        </Section>
      )}

      <Section header='Sobre'>
        <Row
          leading={
            <IconChip color='var(--gray)'>
              <User />
            </IconChip>
          }
          title='Fuso horário'
          detail={me.timezone.replace(/_/g, ' ')}
        />
        <Row
          leading={
            <IconChip color={health.data?.status === 'ok' ? 'var(--green)' : 'var(--red)'}>
              <Server />
            </IconChip>
          }
          title='Servidor'
          detail={
            <span data-testid='api-status'>
              {health.isPending
                ? 'Verificando…'
                : health.data?.status === 'ok'
                  ? 'No ar'
                  : 'Fora do ar'}
            </span>
          }
        />
        <Row
          leading={
            <IconChip color='var(--cyan)'>
              <CalendarSync />
            </IconChip>
          }
          title='Última sincronização'
          detail={
            google.data?.tasksSyncedAt
              ? new Date(google.data.tasksSyncedAt).toLocaleString('pt-BR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })
              : '—'
          }
        />
      </Section>

      <Section>
        <Link to='/privacidade' className='block'>
          <Row chevron title='Política de privacidade' />
        </Link>
        <Link to='/termos' className='block'>
          <Row chevron title='Termos de uso' />
        </Link>
      </Section>

      <Section>
        <Row
          destructive
          title={
            <span className='flex items-center gap-2'>
              <LogOut className='size-4' /> Sair
            </span>
          }
          onClick={() => logout.mutate()}
        />
      </Section>

      <ProfileSheet
        open={sheet === 'profile'}
        onOpenChange={(open) => setSheet(open ? 'profile' : null)}
      />
      <PasswordSheet
        open={sheet === 'password'}
        onOpenChange={(open) => setSheet(open ? 'password' : null)}
      />
    </Page>
  );
}

function ProfileSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useMe().data!;
  const update = useUpdateProfile();
  const [name, setName] = useState(me.name);
  const [timezone, setTimezone] = useState(me.timezone);
  const [weekStartsOn, setWeekStartsOn] = useState(String(me.weekStartsOn));

  const zones = TIMEZONES.includes(me.timezone) ? TIMEZONES : [me.timezone, ...TIMEZONES];
  const { errors, validate } = useFormErrors({ name: !name.trim() && 'Informe seu nome.' });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title='Perfil'
      confirmLabel='OK'
      confirmDisabled={update.isPending}
      onConfirm={async () => {
        if (!validate()) return;
        await update.mutateAsync({
          name: name.trim(),
          timezone,
          weekStartsOn: Number(weekStartsOn),
        });
        onOpenChange(false);
      }}
    >
      <Section>
        <FieldRow label='Nome' error={errors.name}>
          <TextInput align='right' value={name} onChange={(e) => setName(e.target.value)} />
        </FieldRow>
        <FieldRow label='E-mail'>
          <span className='text-label-2 truncate'>{me.email}</span>
        </FieldRow>
      </Section>
      <Section footer='Datas, lembretes e o resumo do dia seguem este fuso.'>
        <Row
          leading={
            <IconChip color='var(--blue)'>
              <Globe />
            </IconChip>
          }
          title='Fuso horário'
          trailing={
            <SelectInput
              value={timezone}
              onChange={setTimezone}
              options={zones.map((zone) => ({
                value: zone,
                label: zone.split('/').pop()!.replace(/_/g, ' '),
              }))}
            />
          }
        />
        <Row
          leading={
            <IconChip color='var(--red)'>
              <CalendarSync />
            </IconChip>
          }
          title='Semana começa'
          trailing={
            <SelectInput
              value={weekStartsOn}
              onChange={setWeekStartsOn}
              options={[
                { value: '0', label: 'Domingo' },
                { value: '1', label: 'Segunda-feira' },
              ]}
            />
          }
        />
      </Section>
    </Sheet>
  );
}

function PasswordSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useMe().data!;
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const { errors, validate } = useFormErrors({
    current: me.hasPassword && !current && 'Informe a senha atual.',
    next: !next ? 'Informe a nova senha.' : next.length < 8 && 'Use pelo menos 8 caracteres.',
    confirm: !confirm ? 'Repita a nova senha.' : next !== confirm && 'As senhas não são iguais.',
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={me.hasPassword ? 'Alterar Senha' : 'Criar Senha'}
      confirmLabel='OK'
      confirmDisabled={change.isPending}
      onConfirm={async () => {
        if (!validate()) return;
        await change.mutateAsync({ currentPassword: current || undefined, newPassword: next });
        toast.success('Senha alterada.');
        setCurrent('');
        setNext('');
        setConfirm('');
        onOpenChange(false);
      }}
    >
      <Section footer='Pelo menos 8 caracteres.'>
        {me.hasPassword && (
          <FieldRow label='Atual' error={errors.current}>
            <TextInput
              type='password'
              align='right'
              autoComplete='current-password'
              placeholder='obrigatória'
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </FieldRow>
        )}
        <FieldRow label='Nova' error={errors.next}>
          <TextInput
            type='password'
            align='right'
            autoComplete='new-password'
            placeholder='nova senha'
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </FieldRow>
        <FieldRow label='Confirmar' error={errors.confirm}>
          <TextInput
            type='password'
            align='right'
            autoComplete='new-password'
            placeholder='de novo'
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </FieldRow>
      </Section>
    </Sheet>
  );
}

export function GoogleGlyph({ className = 'size-[17px]' }: { className?: string }) {
  return (
    <svg viewBox='0 0 24 24' className={className} aria-hidden>
      <path
        fill='#4285F4'
        d='M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z'
      />
      <path
        fill='#34A853'
        d='M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z'
      />
      <path fill='#FBBC05' d='M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z' />
      <path
        fill='#EA4335'
        d='M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z'
      />
    </svg>
  );
}
