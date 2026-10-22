import type {
  AssistantAccess,
  AssistantAdminUser,
  AssistantBenchmarkResponse,
  AssistantBenchmarkRun,
  AssistantDraft,
  AssistantFeedbackItem,
} from '@jottape/schemas';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronLeft, Download, Flag, FlaskConical, ListChecks } from 'lucide-react';
import { useState } from 'react';

import { Button, Pill, Skeleton, Switch } from '@/components/ios/controls';
import { SelectInput } from '@/components/ios/fields';
import { IconChip, Row, Section } from '@/components/ios/list';
import { Page } from '@/components/ios/page';
import { Sheet } from '@/components/ios/sheet';
import {
  useAssistantAdmin,
  useExportAdmin,
  useResolveFeedback,
  useRunBenchmark,
  useUpdateAssistantUser,
  useUpdateTestCase,
} from '@/features/assistant';
import { dayKey, monthTitle, relativeDay, time, usd } from '@/lib/format';
import { useHiddenMoney } from '@/lib/hidden-money';
import { cn } from '@/lib/utils';
import { AnswerText, TraceDetails } from '@/routes/assistant/assistant-page';

import { INTENT_LABEL, type TestCaseEditing, TestCaseSheet } from './assistant-test-case-sheet';

// Painel do beta do Assistente (só o dono): quem usa, quanto custa, quanto acerta, e os relatos.

const ACCESS: Record<AssistantAccess, { label: string; color: string }> = {
  owner: { label: 'Dono', color: 'var(--indigo)' },
  env: { label: 'Railway', color: 'var(--blue)' },
  app: { label: 'Convidado', color: 'var(--green)' },
  none: { label: 'Sem acesso', color: 'var(--gray)' },
};

const LIMITS = [30, 100, 300, 1000];

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

const when = (iso: string) => `${relativeDay(dayKey(iso))}, ${time(iso)}`;

/** Campos que o usuário troca no cartão antes de salvar. */
const CORRECTION_LABEL: Record<string, string> = {
  kind: 'Tipo',
  amount: 'Valor',
  date: 'Data',
  time: 'Horário',
  end: 'Fim',
  account: 'Conta',
  toAccount: 'Conta de destino',
  category: 'Categoria',
  description: 'Descrição',
  installments: 'Parcelas',
  title: 'Título',
  location: 'Local',
  notes: 'Notas',
  allDay: 'Dia inteiro',
  list: 'Lista',
};

const ENGINE_LABEL = { haiku: 'Haiku', jev: 'Jev', answer: 'Resposta', change: 'Mudança' };

export function AssistantAdminPage() {
  const navigate = useNavigate();
  const admin = useAssistantAdmin();
  const benchmark = useRunBenchmark();
  const exportData = useExportAdmin();
  const updateCase = useUpdateTestCase();
  const [userId, setUserId] = useState<string | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TestCaseEditing | null>(null);

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

  const data = admin.data;
  if (!data) {
    return (
      <Page title='Jotta' eyebrow='Beta' leading={back}>
        {admin.isError ? (
          <p className='text-body text-label-2 px-4'>Só o dono do app vê este painel.</p>
        ) : (
          <Skeleton className='h-60 w-full rounded-[var(--radius)]' />
        )}
      </Page>
    );
  }

  const active = data.users.filter((u) => u.access !== 'none');
  const requests = data.users.reduce((s, u) => s + u.month.requests, 0);
  const cost = data.users.reduce((s, u) => s + u.month.costMicros, 0);
  const open = data.feedback.filter((f) => !f.resolvedAt);
  const user = data.users.find((u) => u.id === userId) ?? null;
  const feedback = data.feedback.find((f) => f.id === feedbackId) ?? null;

  return (
    <Page title='Jotta' eyebrow='Beta' leading={back}>
      <Section
        header={monthTitle(data.month)}
        footer='O custo é estimado pelos tokens de cada pedido e inclui as transcrições, os insights do briefing e os testes.'
      >
        <Row title='Pedidos' detail={requests.toLocaleString('pt-BR')} />
        <Row title='Custo estimado' detail={usd(cost)} />
        <Row title='Com acesso' detail={count(active.length, 'pessoa', 'pessoas')} />
        <Row title='Limite padrão' detail={`${data.defaultLimit} por mês`} />
        <Row title='Jev' detail={data.services.jev ? 'Ligado' : 'Sem a chave'} />
        <Row title='Transcrição' detail={data.services.transcription ? 'Ligada' : 'Sem a chave'} />
      </Section>

      <Section
        header='Pessoas'
        footer='Toque para dar ou tirar o acesso e mudar o limite. Quem entra precisa ter conta no Jottape.'
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
                : `${count(u.month.requests, 'pedido', 'pedidos')} · ${usd(u.month.costMicros)}`
            }
            trailing={<Pill color={ACCESS[u.access].color}>{ACCESS[u.access].label}</Pill>}
          />
        ))}
      </Section>

      <Section
        header={open.length ? `Relatos · ${open.length} em aberto` : 'Relatos'}
        footer='Cada “Isso está errado” guarda o pedido, a resposta e os passos, mesmo depois que a conversa some.'
      >
        {data.feedback.length === 0 && <Row title='Nenhum relato ainda' disabled />}
        {data.feedback.map((f) => (
          <Row
            key={f.id}
            chevron
            onClick={() => setFeedbackId(f.id)}
            leading={
              <IconChip color={f.resolvedAt ? 'var(--gray)' : 'var(--orange)'}>
                <Flag />
              </IconChip>
            }
            title={f.request || '(sem pedido)'}
            subtitle={[f.userName, when(f.createdAt), f.note].filter(Boolean).join(' · ')}
            trailing={f.resolvedAt ? <Pill>Visto</Pill> : undefined}
          />
        ))}
      </Section>

      <Section
        header='Casos de teste'
        footer='Relatos que viraram caso. Os ligados rodam no teste de acerto junto com os 50 exemplos.'
      >
        {data.testCases.length === 0 && (
          <Row
            title='Nenhum caso ainda'
            subtitle='Abra um relato e toque em “Virar caso de teste”.'
            disabled
          />
        )}
        {data.testCases.map((c) => (
          <Row
            key={c.id}
            chevron
            onClick={() => setEditing({ mode: 'edit', testCase: c })}
            leading={
              <IconChip color={c.active ? 'var(--purple)' : 'var(--gray)'}>
                <ListChecks />
              </IconChip>
            }
            title={c.text}
            subtitle={c.expect.intents.map((i) => INTENT_LABEL[i]).join(' + ')}
            trailing={
              <span onClick={(event) => event.stopPropagation()}>
                <Switch
                  label='Rodar no teste'
                  checked={c.active}
                  disabled={updateCase.isPending}
                  onChange={(active) => updateCase.mutate({ id: c.id, body: { active } })}
                />
              </span>
            }
          />
        ))}
      </Section>

      <BenchmarkSection run={benchmark} runs={data.runs} />

      <Section footer='Baixa um arquivo com os relatos, os casos de teste e os números de cada pessoa.'>
        <Row
          leading={
            <IconChip color='var(--blue)'>
              <Download />
            </IconChip>
          }
          title={exportData.isPending ? 'Exportando…' : 'Exportar relatos'}
          action={!exportData.isPending}
          disabled={exportData.isPending}
          onClick={() => exportData.mutate()}
        />
      </Section>

      <UserSheet user={user} onClose={() => setUserId(null)} />
      <FeedbackSheet
        feedback={feedback}
        onClose={() => setFeedbackId(null)}
        onCase={(f) => {
          setFeedbackId(null);
          const existing = data.testCases.find((c) => c.id === f.testCaseId);
          setEditing(
            existing
              ? { mode: 'edit', testCase: existing }
              : { mode: 'create', body: { ...f.suggestedCase, feedbackId: f.id } }
          );
        }}
      />
      <TestCaseSheet editing={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}

// ---------------------------------------------------------------- pessoa

function UserSheet({ user, onClose }: { user: AssistantAdminUser | null; onClose: () => void }) {
  const update = useUpdateAssistantUser();
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
                ? 'O dono sempre tem o Jotta, sem limite.'
                : shown.access === 'env'
                  ? 'Liberado por ASSISTANT_EMAILS no Railway: para tirar, mude lá.'
                  : `${shown.email}. Com o acesso, a aba do Jotta aparece na próxima vez que a pessoa abrir o app.`
            }
          >
            <Row
              title='Acesso ao Jotta'
              trailing={
                <Switch
                  label='Acesso ao Jotta'
                  checked={shown.access !== 'none'}
                  disabled={shown.access === 'owner' || shown.access === 'env' || update.isPending}
                  onChange={(access) => update.mutate({ id: shown.id, body: { access } })}
                />
              }
            />
            {shown.access !== 'owner' && (
              <Row
                title='Pedidos por mês'
                trailing={
                  <SelectInput
                    value={shown.customLimit === null ? '' : String(shown.customLimit)}
                    onChange={(value) =>
                      update.mutate({
                        id: shown.id,
                        body: { limit: value === '' ? null : Number(value) },
                      })
                    }
                    options={[
                      { value: '', label: 'Padrão' },
                      ...[...new Set([...LIMITS, shown.customLimit ?? LIMITS[0]])]
                        .sort((a, b) => a - b)
                        .map((n) => ({ value: String(n), label: n.toLocaleString('pt-BR') })),
                    ]}
                  />
                }
              />
            )}
          </Section>

          <Section header='Este mês'>
            <Row
              title='Pedidos'
              detail={
                shown.limit === null
                  ? shown.month.requests.toLocaleString('pt-BR')
                  : `${shown.month.requests} de ${shown.limit}`
              }
            />
            <Row
              title='Áudios'
              detail={`${shown.month.transcriptions} · ${Math.round(shown.month.audioSeconds)} s`}
            />
            <Row title='Custo estimado' detail={usd(shown.month.costMicros)} />
          </Section>

          <Section header='Últimos 30 dias'>
            <Row title='Cartões montados' detail={shown.recent.cards} />
            <Row title='Salvos sozinhos' detail={shown.recent.autoSaved} />
            <Row title='Salvos ao todo' detail={shown.recent.saved} />
            <Row title='Editados antes de salvar' detail={shown.recent.edited} />
            <Row title='Desfeitos' detail={shown.recent.undone} />
            <Row title='Descartados' detail={shown.recent.discarded} />
            <Row title='Esperando' detail={shown.recent.pending} />
            <Row title='Falhas do Haiku' detail={<Bad n={shown.recent.haikuFailed} />} />
            <Row title='Falhas do Jev' detail={<Bad n={shown.recent.jevFailed} />} />
            <Row title='Falhas nas respostas' detail={<Bad n={shown.recent.answerFailed} />} />
            <Row title='Relatos' detail={shown.recent.reports} />
          </Section>

          {Object.keys(shown.corrections).length > 0 && (
            <Section
              header='O que corrige antes de salvar'
              footer='Só a contagem de cada campo trocado no cartão, nos últimos 30 dias.'
            >
              {Object.entries(shown.corrections)
                .sort((a, b) => b[1] - a[1])
                .map(([field, n]) => (
                  <Row key={field} title={CORRECTION_LABEL[field] ?? field} detail={n} />
                ))}
            </Section>
          )}

          {shown.failures.length > 0 && (
            <Section header='Últimas falhas' footer='O erro de cada serviço, sem o pedido.'>
              {shown.failures.map((f, i) => (
                <Row
                  key={i}
                  title={f.error ?? 'Sem detalhe'}
                  subtitle={`${ENGINE_LABEL[f.engine]} · ${when(f.at)}`}
                  wrapSubtitle
                  className='[&_.truncate]:whitespace-normal'
                />
              ))}
            </Section>
          )}
        </>
      )}
    </Sheet>
  );
}

const Bad = ({ n }: { n: number }) => <span className={cn(n > 0 && 'text-red')}>{n}</span>;

// ---------------------------------------------------------------- relato

function DraftLine({ draft }: { draft: AssistantDraft }) {
  const { format } = useHiddenMoney();
  if (draft.type === 'transaction') {
    return (
      <>
        {draft.description} · {draft.amountCents ? format(draft.amountCents) : 'sem valor'} ·{' '}
        {relativeDay(draft.date)}
      </>
    );
  }
  if (draft.type === 'event') {
    return (
      <>
        Evento: {draft.title} · {relativeDay(draft.date)}
        {draft.startTime ? `, ${draft.startTime}` : ''}
        {draft.notes ? ` · Notas: ${draft.notes}` : ''}
      </>
    );
  }
  if (draft.type === 'task') {
    return (
      <>
        Tarefa: {draft.title}
        {draft.notes ? ` · Notas: ${draft.notes}` : ''}
      </>
    );
  }
  const action = { update: 'Mudar', delete: 'Apagar', complete: 'Concluir' }[draft.action];
  return (
    <>
      {action}: {draft.title}
    </>
  );
}

function FeedbackSheet({
  feedback,
  onClose,
  onCase,
}: {
  feedback: AssistantFeedbackItem | null;
  onClose: () => void;
  onCase: (feedback: AssistantFeedbackItem) => void;
}) {
  const resolve = useResolveFeedback();
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
          <Section header={`${shown.userName} · ${when(shown.createdAt)}`}>
            <Row
              title={shown.request || '(sem pedido)'}
              subtitle='Pedido'
              wrapSubtitle
              className='[&_.truncate]:whitespace-normal'
            />
            <div className='text-body px-4 py-2.5 whitespace-pre-wrap'>
              <AnswerText text={shown.reply} values={shown.values} />
            </div>
          </Section>
          {shown.note && (
            <Section header='O que estava errado'>
              <p className='text-body px-4 py-2.5 whitespace-pre-wrap'>{shown.note}</p>
            </Section>
          )}
          {shown.cards.length > 0 && (
            <Section header='O que o Jotta montou'>
              {shown.cards.map((draft, i) => (
                <p
                  key={i}
                  className='text-subhead px-4 py-2 shadow-[inset_0_-0.5px_0_var(--separator)] last:shadow-none'
                >
                  <DraftLine draft={draft} />
                </p>
              ))}
            </Section>
          )}
          {shown.trace && (
            <Section header='Passos'>
              <div className='py-2.5'>
                <TraceDetails trace={shown.trace} always />
              </div>
            </Section>
          )}
          <div className='flex flex-col gap-2'>
            <Button size='md' className='w-full' onClick={() => onCase(shown)}>
              {shown.testCaseId ? 'Ver o caso de teste' : 'Virar caso de teste'}
            </Button>
            <Button
              variant='gray'
              size='md'
              className='w-full'
              loading={resolve.isPending}
              onClick={() => resolve.mutate({ id: shown.id, resolved: !shown.resolvedAt })}
            >
              {shown.resolvedAt ? 'Reabrir' : 'Marcar como visto'}
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- teste de acerto

function BenchmarkSection({
  run,
  runs,
}: {
  run: ReturnType<typeof useRunBenchmark>;
  runs: AssistantBenchmarkRun[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((r) => r.id === selectedId) ?? runs[0];
  const result: AssistantBenchmarkResponse | undefined = selected ?? run.data;
  const failed = result?.cases.filter((c) => !c.passed) ?? [];
  const score = (source: 'fixed' | 'real') => {
    const cases = result?.cases.filter((c) => c.source === source) ?? [];
    const passed = cases.filter((c) => c.passed).length;
    return { total: cases.length, passed };
  };
  const real = score('real');
  const fixed = score('fixed');
  return (
    <>
      <Section
        header='Teste de acerto'
        footer='Roda 50 pedidos de exemplo e os casos de teste ligados pelo Haiku e pelo Jev de verdade. Leva perto de um minuto, custa uns 5 centavos de dólar e não conta no limite.'
      >
        <Row
          leading={
            <IconChip color='var(--purple)'>
              <FlaskConical />
            </IconChip>
          }
          title={run.isPending ? 'Rodando os pedidos…' : 'Rodar o teste'}
          action={!run.isPending}
          disabled={run.isPending}
          onClick={() => run.mutate()}
        />
        {result && (
          <>
            <Row
              title='Acertos'
              detail={`${result.passed} de ${result.total} (${Math.round((result.passed / result.total) * 100)}%)`}
            />
            {real.total > 0 && (
              <>
                <Row title='Exemplos' detail={`${fixed.passed} de ${fixed.total}`} />
                <Row title='Casos reais' detail={`${real.passed} de ${real.total}`} />
              </>
            )}
            <Row title='Salvaria sozinho e certo' detail={result.autoSavedRight} />
            <Row title='Salvaria sozinho e errado' detail={<Bad n={result.autoSavedWrong} />} />
            <Row
              title='Tempo e custo'
              detail={`${Math.round(result.ms / 1000)} s · ${usd(result.costMicros)}`}
            />
          </>
        )}
      </Section>
      {runs.length > 0 && (
        <Section
          header='Rodadas'
          footer='As do painel e as da CI, em cada PR que mexe no Jotta. Toque para ver os erros de uma.'
        >
          {runs.map((r) => (
            <Row
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              title={`${r.passed} de ${r.total}`}
              subtitle={[
                r.source === 'CI' ? (r.label ?? 'CI') : 'Painel',
                r.commit?.slice(0, 7),
                when(r.ranAt),
              ]
                .filter(Boolean)
                .join(' · ')}
              trailing={
                <span className='flex items-center gap-2'>
                  {r.regressions > 0 && (
                    <Pill color='var(--red)'>
                      {r.regressions === 1 ? '1 quebrou' : `${r.regressions} quebraram`}
                    </Pill>
                  )}
                  {r.id === selected?.id && (
                    <Check className='text-tint size-5' strokeWidth={2.5} />
                  )}
                </span>
              }
            />
          ))}
        </Section>
      )}
      {failed.length > 0 && (
        <Section header={`Erros · ${failed.length}`}>
          {failed.map((c) => (
            <div
              key={c.caseId ?? c.text}
              className='px-4 py-2.5 shadow-[inset_0_-0.5px_0_var(--separator)] last:shadow-none'
            >
              <div className='text-body flex items-start justify-between gap-2'>
                <span>“{c.text}”</span>
                <span className='flex shrink-0 gap-1'>
                  {c.source === 'real' && <Pill color='var(--purple)'>Real</Pill>}
                  {c.autoSave && <Pill color='var(--red)'>Salvaria</Pill>}
                </span>
              </div>
              <p className='text-footnote text-label-2'>Esperado: {c.expected}</p>
              <p className='text-footnote text-red'>Veio: {c.got}</p>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}
