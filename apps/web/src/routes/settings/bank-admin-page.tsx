import type { BankAdminFeedback, BankAdminUser, BankStage } from '@jottape/schemas';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronLeft } from 'lucide-react';
import { useState } from 'react';

import { Button, Pill, Skeleton, Switch } from '@/components/ios/controls';
import { IconChip, Row, Section } from '@/components/ios/list';
import { Page } from '@/components/ios/page';
import { Sheet } from '@/components/ios/sheet';
import { useBankAdmin, useResolveBankFeedback, useUpdateBankUser } from '@/features/bank';
import { dayKey, relativeDay, time } from '@/lib/format';

// Painel do beta de Bancos (só o dono): quem testa, até onde chegou, o que casou ou precisou de
// revisão nos últimos 30 dias, os erros e os relatos de "Algo veio errado".

const ACCESS: Record<BankAdminUser['access'], { label: string; color: string }> = {
  owner: { label: 'Dono', color: 'var(--indigo)' },
  app: { label: 'Convidado', color: 'var(--green)' },
  none: { label: 'Sem acesso', color: 'var(--gray)' },
};

const STAGES: { value: BankStage; label: string }[] = [
  { value: 'none', label: 'Não começou' },
  { value: 'keys', label: 'Chaves salvas' },
  { value: 'bank', label: 'Banco conectado' },
  { value: 'linked', label: 'Conta ligada' },
  { value: 'accepted', label: 'Já lançou da revisão' },
];

const stageLabel = (stage: BankStage) => STAGES.find((s) => s.value === stage)!.label;

const when = (iso: string) => `${relativeDay(dayKey(iso))}, ${time(iso)}`;

export function BankAdminPage() {
  const navigate = useNavigate();
  const admin = useBankAdmin();
  const [userId, setUserId] = useState<string | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);

  const back = (
    <button
      type='button'
      onClick={() => navigate({ to: '/ajustes/beta' })}
      className='text-tint text-body -ml-2 flex items-center active:opacity-40'
    >
      <ChevronLeft className='size-7' strokeWidth={2.2} />
      Beta
    </button>
  );

  const data = admin.data;
  if (!data) {
    return (
      <Page title='Bancos' eyebrow='Beta' leading={back}>
        {admin.isError ? (
          <p className='text-body text-label-2 px-4'>Só o dono do app vê este painel.</p>
        ) : (
          <Skeleton className='h-60 w-full rounded-[var(--radius)]' />
        )}
      </Page>
    );
  }

  const testers = data.users.filter((u) => u.access !== 'none');
  const open = data.feedback.filter((f) => !f.resolvedAt);
  const user = data.users.find((u) => u.id === userId) ?? null;
  const feedback = data.feedback.find((f) => f.id === feedbackId) ?? null;

  return (
    <Page title='Bancos' eyebrow='Beta' leading={back}>
      <Section
        header='Até onde chegaram'
        footer='Contando o dono e os convidados. A meta do beta é 7 de 10 chegarem a "Conta ligada" sem ajuda.'
      >
        {STAGES.map((stage) => (
          <Row
            key={stage.value}
            title={stage.label}
            detail={testers.filter((u) => u.stage === stage.value).length}
          />
        ))}
      </Section>

      <Section
        header='Pessoas'
        footer='Toque para dar ou tirar o acesso. Com ele, Ajustes › Bancos aparece para a pessoa.'
      >
        {data.users.map((u) => (
          <Row
            key={u.id}
            chevron
            onClick={() => setUserId(u.id)}
            leading={
              <IconChip color={ACCESS[u.access].color} round>
                <span className='text-subhead font-semibold'>{u.name.charAt(0).toUpperCase()}</span>
              </IconChip>
            }
            title={u.name}
            subtitle={
              u.access === 'none'
                ? u.email
                : [
                    stageLabel(u.stage),
                    u.errors.length
                      ? `${u.errors.length} ${u.errors.length === 1 ? 'erro' : 'erros'}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
            }
            trailing={<Pill color={ACCESS[u.access].color}>{ACCESS[u.access].label}</Pill>}
          />
        ))}
      </Section>

      <Section
        header={`Relatos${open.length ? ` · ${open.length} ${open.length === 1 ? 'aberto' : 'abertos'}` : ''}`}
        footer='O "Algo veio errado" de Ajustes › Bancos e da revisão. Vem com os bancos e as contas daquele momento, nunca com as chaves.'
      >
        {data.feedback.length === 0 && <Row title='Nenhum relato ainda' />}
        {data.feedback.map((f) => (
          <Row
            key={f.id}
            chevron
            onClick={() => setFeedbackId(f.id)}
            title={f.note}
            subtitle={`${f.userName} · ${when(f.createdAt)}`}
            trailing={f.resolvedAt ? <Pill>Visto</Pill> : undefined}
          />
        ))}
      </Section>

      <UserSheet user={user} onClose={() => setUserId(null)} />
      <FeedbackSheet feedback={feedback} onClose={() => setFeedbackId(null)} />
    </Page>
  );
}

// ---------------------------------------------------------------- pessoa

function UserSheet({ user, onClose }: { user: BankAdminUser | null; onClose: () => void }) {
  const update = useUpdateBankUser();
  // Guarda a última pessoa aberta para a folha não esvaziar enquanto fecha.
  const [last, setLast] = useState(user);
  if (user && user !== last) setLast(user);
  const shown = user ?? last;

  return (
    <Sheet
      open={user !== null}
      onOpenChange={(open) => !open && onClose()}
      title={shown?.name ?? ''}
      cancelLabel='OK'
    >
      {shown && (
        <>
          <Section
            footer={
              shown.access === 'owner'
                ? 'O dono sempre tem os Bancos.'
                : `${shown.email}. Sem o acesso, a tela some e os bancos param de sincronizar; o que já foi lançado fica.`
            }
          >
            <Row
              title='Acesso aos Bancos'
              trailing={
                <Switch
                  label='Acesso aos Bancos'
                  checked={shown.access !== 'none'}
                  disabled={shown.access === 'owner' || update.isPending}
                  onChange={(bankAccess) => update.mutate({ id: shown.id, bankAccess })}
                />
              }
            />
          </Section>

          <Section header='Configuração'>
            <Row title='Etapa' detail={stageLabel(shown.stage)} />
            <Row title='Bancos conectados' detail={shown.banks} />
            <Row title='Contas ligadas' detail={shown.linkedAccounts} />
            <Row
              title='Última sincronização'
              detail={shown.syncedAt ? when(shown.syncedAt) : 'Nunca'}
            />
            <Row
              title='Atraso médio'
              detail={
                shown.lagDays === null
                  ? '—'
                  : `${shown.lagDays.toLocaleString('pt-BR')} ${shown.lagDays === 1 ? 'dia' : 'dias'}`
              }
            />
          </Section>

          <Section
            header='Lançamentos dos últimos 30 dias'
            footer='Casaram: bateram com um lançamento que já existia. Editados: tipo, categoria ou descrição trocados ao lançar da revisão.'
          >
            <Row title='Casaram sozinhos' detail={shown.last30.matched} />
            <Row title='Lançados da revisão' detail={shown.last30.imported} />
            <Row title='Editados ao lançar' detail={shown.last30.edited} />
            <Row title='Ignorados' detail={shown.last30.ignored} />
            <Row title='Esperando revisão' detail={shown.last30.pending} />
          </Section>

          {shown.errors.length > 0 && (
            <Section header='Erros agora'>
              {shown.errors.map((error) => (
                <Row key={error} title={error} wrapSubtitle />
              ))}
            </Section>
          )}
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- relato

function FeedbackSheet({
  feedback,
  onClose,
}: {
  feedback: BankAdminFeedback | null;
  onClose: () => void;
}) {
  const resolve = useResolveBankFeedback();
  const [last, setLast] = useState(feedback);
  if (feedback && feedback !== last) setLast(feedback);
  const shown = feedback ?? last;

  return (
    <Sheet
      open={feedback !== null}
      onOpenChange={(open) => !open && onClose()}
      title='Relato'
      cancelLabel='OK'
      tall
    >
      {shown && (
        <>
          <Section footer={`${shown.userName} · ${when(shown.createdAt)}`}>
            <p className='text-body whitespace-pre-wrap px-4 py-3'>{shown.note}</p>
          </Section>
          <Section header='Estado no momento do relato'>
            <pre className='text-caption text-label-2 bg-surface overflow-x-auto whitespace-pre-wrap rounded-[var(--radius)] p-3 font-mono'>
              {JSON.stringify(shown.snapshot, null, 2)}
            </pre>
          </Section>
          {!shown.resolvedAt && (
            <Button
              className='w-full'
              loading={resolve.isPending}
              onClick={() => resolve.mutate(shown.id)}
            >
              <Check className='size-5' /> Marcar como visto
            </Button>
          )}
        </>
      )}
    </Sheet>
  );
}
