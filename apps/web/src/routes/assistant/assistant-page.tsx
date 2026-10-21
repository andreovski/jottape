import type {
  AssistantMessageBody,
  AssistantMessageResponse,
  AssistantTrace,
} from '@jottape/schemas';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowUp, ChevronRight, Flag, Keyboard, Mic, Sparkles, SquarePen, X } from 'lucide-react';
import { type FormEvent, Fragment, useEffect, useRef, useState } from 'react';

import { Button, EmptyState, Skeleton } from '@/components/ios/controls';
import { TextArea } from '@/components/ios/fields';
import { BarButton, Page } from '@/components/ios/page';
import { ActionSheet, Sheet } from '@/components/ios/sheet';
import { fillValues } from '@/components/today/briefing-card';
import {
  useAssistant,
  useClearAssistant,
  useReportMessage,
  useSendAssistantMessage,
  useTranscribe,
} from '@/features/assistant';
import { useAccounts, useCategories } from '@/features/finance';
import { useDevMode } from '@/lib/dev-mode';
import { time, usd } from '@/lib/format';
import { useHiddenMoney } from '@/lib/hidden-money';
import { cn } from '@/lib/utils';

import { AssistantCard } from './assistant-card';
import { type Step, stepTag, type Tag, TAG_COLOR, toSteps } from './steps';
import { MAX_SECONDS, useVoice, voiceMode } from './use-voice';
import { Waveform } from './waveform';

// Jotta: o Assistente com cara de console. A conversa é uma linha do tempo de pedidos, cada um com
// a etiqueta do módulo (FIN, AGD, TAR, ASK), a hora e se veio por voz ou texto.

/** Exemplos da tela vazia: mostram o que dá para pedir em cada módulo. */
const COMMANDS: { tag: Tag; text: string }[] = [
  { tag: 'FIN', text: 'Gastei 32 reais no mercado' },
  { tag: 'AGD', text: 'Dentista amanhã às 15h' },
  { tag: 'TAR', text: 'Me lembra de pagar o IPVA sexta' },
  { tag: 'ASK', text: 'Quanto gastei ontem com comida?' },
  { tag: 'FIN', text: 'Comprei um fone de 600 em 3x' },
];

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const secondsLabel = (ms: number) =>
  `${(ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;

/** Milissegundos desde que o componente montou (para o "processando · 1,2 s"). */
function useElapsed() {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => setMs(Date.now() - startedAt), 100);
    return () => clearInterval(timer);
  }, []);
  return ms;
}

export function AssistantPage() {
  const state = useAssistant();
  const { data: accounts = [] } = useAccounts({ archived: true });
  const { data: categories = [] } = useCategories();
  const send = useSendAssistantMessage();
  const transcribe = useTranscribe();
  const clear = useClearAssistant();
  const { pergunta } = useSearch({ from: '/app/assistente' });
  const navigate = useNavigate();
  // Pergunta de um insight do briefing: fica no campo para a pessoa conferir e enviar.
  const [text, setText] = useState(() => pergunta ?? '');
  const [menu, setMenu] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  // Tira a pergunta do endereço, para não voltar ao recarregar.
  useEffect(() => {
    if (pergunta) void navigate({ to: '/assistente', search: {}, replace: true });
  }, [pergunta, navigate]);

  const data = state.data;
  const messages = data?.messages ?? [];
  const mode = voiceMode(Boolean(data?.transcription));
  const atLimit = Boolean(data && data.usage.limit !== null && data.usage.used >= data.usage.limit);
  const thinking = send.isPending || transcribe.isPending;

  function submit(value: string, voiceSeconds?: number) {
    const trimmed = value.trim();
    if (!trimmed || thinking || atLimit) return;
    setText('');
    send.mutate({ text: trimmed, voiceSeconds }, { onError: () => setText(trimmed) });
  }

  const voice = useVoice({
    mode,
    onAudio: (audio, seconds) =>
      transcribe.mutate(
        { audio, seconds },
        {
          onSuccess: ({ text: heard }) => {
            if (heard) submit(heard, seconds);
          },
        }
      ),
    onText: (heard, final, seconds) => {
      if (final) submit(heard, seconds);
      else setText(heard);
    },
  });

  // Pedido novo (ou "processando"): rola até o fim, como no Mensagens.
  const pending: AssistantMessageBody | null = send.isPending ? send.variables : null;
  useEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pending, transcribe.isPending]);

  // O campo cresce até 5 linhas.
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }, [text]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(text);
  };

  if (data && !data.enabled) {
    return (
      <Page title='Jotta'>
        <EmptyState
          icon={<Sparkles />}
          title='Jotta indisponível'
          message='O Jotta ainda não foi ligado neste servidor.'
        />
      </Page>
    );
  }

  const usage = data?.usage;
  const steps = toSteps(messages);
  const empty = messages.length === 0 && !pending && !transcribe.isPending;

  return (
    <Page
      title='Jotta'
      subtitle={usage && <StatusLine used={usage.used} limit={usage.limit} voice={Boolean(mode)} />}
      actions={
        messages.length > 0 && (
          <BarButton label='Nova conversa' onClick={() => setMenu(true)}>
            <SquarePen strokeWidth={2.2} />
          </BarButton>
        )
      }
    >
      {state.isPending ? (
        <div className='space-y-3 pt-4'>
          <Skeleton className='h-5 w-2/3' />
          <Skeleton className='h-36 w-full' />
        </div>
      ) : empty ? (
        <EmptyConsole onPick={setText} />
      ) : (
        <ol className='relative mt-2 space-y-6 pl-12'>
          {/* O fio da linha do tempo, que some no fim. */}
          <div
            aria-hidden
            className='absolute top-3 bottom-0 left-[17px] w-[1.5px] bg-gradient-to-b from-[color-mix(in_srgb,var(--tint)_70%,transparent)] to-transparent'
          />
          {steps.map((step, index) => (
            <StepItem
              key={step.request?.id ?? step.replies[0]?.id ?? index}
              step={step}
              accounts={accounts}
              categories={categories}
            />
          ))}
          {(pending || transcribe.isPending) && (
            <WorkingStep
              text={pending?.text ?? null}
              voiceSeconds={pending?.voiceSeconds ?? null}
              transcribing={transcribe.isPending}
            />
          )}
        </ol>
      )}

      {atLimit && usage?.limit != null && (
        <p className='text-caption text-label-3 mt-6 text-center'>
          Você usou os {usage.limit} pedidos do mês. O limite volta no dia 1º.
        </p>
      )}

      {/* Espaço para o campo fixo embaixo. */}
      <div aria-hidden className='h-28' />

      {voice.listening && (
        <div
          aria-hidden
          className='fixed inset-0 z-20 bg-black/45 backdrop-blur-[2px] transition-opacity'
        />
      )}

      <div className='fixed inset-x-0 bottom-[calc(50px+env(safe-area-inset-bottom))] z-30 lg:bottom-0 lg:left-64'>
        <div className='bottom-scrim pointer-events-none absolute inset-x-0 -top-6 bottom-0' />
        <div className='relative mx-auto max-w-3xl px-4 pb-3 lg:px-8 lg:pb-6'>
          {voice.listening ? (
            <VoicePanel
              seconds={voice.seconds}
              stream={voice.stream}
              liveText={mode === 'browser' ? text : ''}
              onCancel={voice.cancel}
              onFinish={voice.finish}
            />
          ) : (
            <form
              onSubmit={onSubmit}
              className='bg-surface bar-shadow flex items-end gap-1.5 rounded-[18px] py-1.5 pr-1.5 pl-4'
            >
              <span aria-hidden className='text-tint py-[7px] font-mono text-[17px] font-semibold'>
                ›
              </span>
              <textarea
                ref={input}
                rows={1}
                value={text}
                maxLength={1000}
                disabled={atLimit}
                placeholder={atLimit ? 'Limite do mês atingido' : 'Peça algo'}
                aria-label='Pedido'
                enterKeyHint='send'
                className='text-body placeholder:text-label-3 max-h-[120px] min-h-10 flex-1 resize-none bg-transparent py-[7px] outline-none'
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit(text);
                  }
                }}
              />
              {text.trim() || !mode ? (
                <button
                  type='submit'
                  aria-label='Enviar'
                  disabled={!text.trim() || thinking || atLimit}
                  className='bg-tint flex size-10 shrink-0 items-center justify-center rounded-[13px] text-white transition-opacity active:opacity-70 disabled:opacity-30'
                >
                  <ArrowUp className='size-5' strokeWidth={2.6} />
                </button>
              ) : (
                <button
                  type='button'
                  aria-label='Ditar'
                  disabled={thinking || atLimit}
                  className='text-tint bg-tint/15 flex size-10 shrink-0 items-center justify-center rounded-[13px] shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--tint)_45%,transparent)] transition-opacity active:opacity-60 disabled:opacity-30'
                  onClick={() => void voice.start()}
                >
                  <Mic className='size-5' strokeWidth={2.2} />
                </button>
              )}
            </form>
          )}
        </div>
      </div>

      <ActionSheet
        open={menu}
        onOpenChange={setMenu}
        title='Começar uma nova conversa? Os lançamentos salvos continuam no extrato.'
        actions={[
          {
            label: 'Nova conversa',
            destructive: true,
            onSelect: () => clear.mutate(),
          },
        ]}
      />
    </Page>
  );
}

const MONO_CAPS = 'font-mono text-[11px] tracking-[0.06em] uppercase';

/** Status sob o título: no ar, voz e pedidos do mês. */
function StatusLine({
  used,
  limit,
  voice,
}: {
  used: number;
  limit: number | null;
  voice: boolean;
}) {
  const atLimit = limit !== null && used >= limit;
  return (
    <div className={cn('text-label-2 mt-1 flex items-center gap-2', MONO_CAPS)}>
      <span
        aria-hidden
        className='size-[7px] rounded-full'
        style={{
          background: atLimit ? 'var(--orange)' : 'var(--green)',
          boxShadow: `0 0 8px ${atLimit ? 'var(--orange)' : 'var(--green)'}`,
        }}
      />
      <span>{atLimit ? 'Limite do mês' : voice ? 'Online · voz ativa' : 'Online'}</span>
      <span className='numeric ml-auto'>
        {limit === null ? `${used} pedidos no mês` : `${used}/${limit}`}
      </span>
      {limit !== null && (
        <span aria-hidden className='bg-fill h-1 w-14 overflow-hidden rounded-full'>
          <span
            className='bg-tint block h-full'
            style={{ width: `${Math.min(100, (used / Math.max(limit, 1)) * 100)}%` }}
          />
        </span>
      )}
    </div>
  );
}

function TagBadge({ tag, live }: { tag: Tag | '···'; live?: boolean }) {
  const color = tag === '···' ? 'var(--tint)' : TAG_COLOR[tag];
  return (
    <span
      aria-hidden
      className={cn(
        'bg-background absolute top-0 -left-12 flex h-5 w-9 items-center justify-center rounded-[6px] font-mono text-[9.5px] font-semibold tracking-[0.06em]',
        live && 'animate-[node-glow_1.6s_ease-in-out_infinite]'
      )}
      style={
        {
          color,
          '--node': color,
          boxShadow: `inset 0 0 0 1px ${color}, 0 0 0 4px var(--background)${live ? `, 0 0 14px ${color}` : ''}`,
        } as React.CSSProperties
      }
    >
      {tag}
    </span>
  );
}

function EmptyConsole({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className='relative'>
      <div aria-hidden className='dot-grid pointer-events-none absolute -inset-x-4 -top-28 h-80' />
      <div className='relative pt-8'>
        <div className={cn('text-tint', MONO_CAPS, 'tracking-[0.08em]')}>
          {'// Jotta · pronto para ouvir'}
        </div>
        <h2 className='text-title-1 mt-2.5 leading-tight font-bold'>
          O que você quer registrar?
          <span
            aria-hidden
            className='bg-tint ml-1 inline-block h-[0.9em] w-[3px] translate-y-[0.12em] animate-[caret-blink_1.1s_steps(1)_infinite] rounded-[1px]'
          />
        </h2>
        <p className='text-subhead text-label-2 mt-2.5'>
          Fale como falaria com alguém. Eu monto o lançamento, o evento ou a tarefa e, quando tenho
          certeza, já salvo, com Desfazer na hora. Também respondo sobre gastos, saldos, agenda e
          tarefas.
        </p>
      </div>

      <div className={cn('text-label-3 mt-7 mb-2 px-1 tracking-[0.1em]', MONO_CAPS)}>
        Experimente
      </div>
      <ul className='bg-surface overflow-hidden rounded-[14px] shadow-[inset_0_0_0_0.5px_var(--separator)]'>
        {COMMANDS.map((command, index) => (
          <li key={command.text} className={cn(index > 0 && 'hairline-t')}>
            <button
              type='button'
              className='text-subhead flex w-full items-center gap-3 px-3.5 py-3 text-left active:opacity-60'
              onClick={() => onPick(command.text)}
            >
              <span
                className='w-10 shrink-0 rounded-[5px] py-[3px] text-center font-mono text-[10.5px] font-semibold tracking-[0.06em]'
                style={{
                  color: TAG_COLOR[command.tag],
                  background: `color-mix(in srgb, ${TAG_COLOR[command.tag]} 14%, transparent)`,
                }}
              >
                {command.tag}
              </span>
              <span className='min-w-0 flex-1 truncate'>{command.text}</span>
              <ChevronRight className='text-label-3 size-4 shrink-0' />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Pedido em mono-prompt: "› gastei 32 no mercado". */
function RequestLine({ text }: { text: string }) {
  return (
    <p className='text-body font-semibold break-words whitespace-pre-wrap'>
      <span aria-hidden className='text-tint mr-1.5 font-mono'>
        ›
      </span>
      {text}
    </p>
  );
}

function MetaLine({ at, voiceSeconds }: { at?: string; voiceSeconds: number | null }) {
  const Icon = voiceSeconds === null ? Keyboard : Mic;
  return (
    <div className='text-label-3 mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em]'>
      <Icon className='size-3' strokeWidth={2.2} />
      {[at && time(at), voiceSeconds === null ? 'TEXTO' : `VOZ · ${voiceSeconds} s`]
        .filter(Boolean)
        .join(' · ')}
    </div>
  );
}

function StepItem({
  step,
  accounts,
  categories,
}: {
  step: Step;
  accounts: Parameters<typeof AssistantCard>[0]['accounts'];
  categories: Parameters<typeof AssistantCard>[0]['categories'];
}) {
  return (
    <li className='relative'>
      <TagBadge tag={stepTag(step)} />
      {step.request && (
        <>
          <RequestLine text={step.request.text} />
          <MetaLine at={step.request.createdAt} voiceSeconds={step.request.voiceSeconds} />
        </>
      )}
      <div className='mt-2.5 space-y-2.5'>
        {step.replies.map((reply) => (
          <Reply key={reply.id} message={reply} accounts={accounts} categories={categories} />
        ))}
      </div>
    </li>
  );
}

/** O pedido que está sendo lido: o nó acende e o tempo corre. */
function WorkingStep({
  text,
  voiceSeconds,
  transcribing,
}: {
  text: string | null;
  voiceSeconds: number | null;
  transcribing: boolean;
}) {
  const ms = useElapsed();
  return (
    <li className='relative'>
      <TagBadge tag='···' live />
      {text ? (
        <>
          <RequestLine text={text} />
          <MetaLine voiceSeconds={voiceSeconds} />
        </>
      ) : (
        <p className='text-body text-label-2 font-semibold'>Áudio gravado</p>
      )}
      <p
        className='text-label-2 numeric mt-2.5 font-mono text-[12px]'
        role='status'
        aria-live='polite'
      >
        <span className='text-tint'>▸</span>{' '}
        {transcribing ? 'transcrevendo o áudio' : 'processando o pedido'} · {secondsLabel(ms)}
      </p>
    </li>
  );
}

function Reply({
  message,
  accounts,
  categories,
}: {
  message: AssistantMessageResponse;
  accounts: Parameters<typeof AssistantCard>[0]['accounts'];
  categories: Parameters<typeof AssistantCard>[0]['categories'];
}) {
  return (
    <div className='space-y-2.5'>
      <p className='text-body text-foreground/85 break-words whitespace-pre-wrap'>
        <AnswerText text={message.text} values={message.values} />
      </p>
      {message.cards.map((card) => (
        <AssistantCard key={card.id} card={card} accounts={accounts} categories={categories} />
      ))}
      {message.trace && <TraceDetails trace={message.trace} />}
      <ReportButton message={message} />
    </div>
  );
}

/** Gravando: onda do microfone, tempo e (no ditado do navegador) o texto ao vivo. */
function VoicePanel({
  seconds,
  stream,
  liveText,
  onCancel,
  onFinish,
}: {
  seconds: number;
  stream: MediaStream | null;
  liveText: string;
  onCancel: () => void;
  onFinish: () => void;
}) {
  return (
    <div className='bg-elevated rounded-[22px] p-3.5 shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--tint)_55%,transparent),0_0_0_4px_color-mix(in_srgb,var(--tint)_10%,transparent),0_-20px_60px_rgb(0_0_0/0.35)]'>
      <div className={cn('text-label-2 flex items-center gap-2', MONO_CAPS)}>
        <span
          aria-hidden
          className='bg-red size-2 animate-pulse rounded-full shadow-[0_0_8px_var(--red)]'
        />
        Gravando
        <span className='text-foreground numeric ml-auto text-[13px]'>
          {clock(seconds)} / {clock(MAX_SECONDS)}
        </span>
      </div>
      <Waveform stream={stream} className='mt-3 h-[84px] w-full' />
      <p
        className={cn(
          'mt-3 line-clamp-3 min-h-[1.3em]',
          liveText ? 'text-title-3 font-semibold' : 'text-subhead text-label-2'
        )}
      >
        {liveText || 'Fale o pedido. Quando terminar, toque em Enviar.'}
      </p>
      <div className='mt-3.5 flex gap-2'>
        <Button variant='gray' size='lg' className='text-foreground flex-1' onClick={onCancel}>
          <X className='size-[18px]' /> Cancelar
        </Button>
        <Button variant='filled' size='lg' className='flex-[2]' onClick={onFinish}>
          <ArrowUp className='size-[18px]' strokeWidth={2.6} /> Enviar
        </Button>
      </div>
    </div>
  );
}

/** "Isso está errado": manda o pedido e a resposta para o dono do app olhar. */
function ReportButton({ message }: { message: AssistantMessageResponse }) {
  const report = useReportMessage();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (message.reported) {
    return <p className='text-caption text-label-3'>Obrigado pelo aviso.</p>;
  }
  const send = () =>
    report.mutate(
      { id: message.id, note: note.trim() || null },
      { onSuccess: () => setOpen(false) }
    );
  return (
    <>
      <button
        type='button'
        className='text-caption text-label-3 flex items-center gap-1 active:opacity-40'
        onClick={() => setOpen(true)}
      >
        <Flag className='size-3' strokeWidth={2.5} /> Isso está errado
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title='Isso está errado'
        confirmLabel='Enviar'
        confirmDisabled={report.isPending}
        onConfirm={send}
      >
        <div className='bg-surface rounded-[var(--radius)] px-4'>
          <TextArea
            aria-label='O que estava errado'
            placeholder='O que estava errado? (opcional)'
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <p className='text-footnote text-label-2 px-4 pt-1.5'>
          O pedido, a resposta e o que o Jotta montou vão para o dono do app, para melhorar o Jotta.
          Fica guardado mesmo depois que a conversa some.
        </p>
      </Sheet>
    </>
  );
}

/** Texto da resposta com os valores no lugar (ou ocultos, como no Hoje). */
export function AnswerText({ text, values }: { text: string; values: number[] }) {
  const { format } = useHiddenMoney();
  if (values.length === 0) return <>{text}</>;
  return (
    <>
      {fillValues(text, values, format).map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}

type Engine = AssistantTrace['steps'][number]['engine'];

const ENGINE_LABELS: Record<Engine, string> = {
  haiku: 'Haiku · leitura',
  jev: 'Jev',
  answer: 'Haiku · resposta',
  change: 'Haiku · mudança',
};

const ENGINE_SHORT: Record<Engine, string> = {
  haiku: 'Haiku',
  jev: 'Jev',
  answer: 'Resposta',
  change: 'Mudança',
};

const ENGINE_COLOR: Record<Engine, string> = {
  haiku: 'var(--tint)',
  jev: 'var(--cyan)',
  answer: 'var(--indigo)',
  change: 'var(--blue)',
};

const tokens = (n: number) => n.toLocaleString('pt-BR');

/**
 * Modo dev: o que rodou nesta resposta, numa barra com o tempo de cada passo, e tokens e custo.
 * `always`: mesmo sem o modo dev (painel do beta).
 */
export function TraceDetails({ trace, always }: { trace: AssistantTrace; always?: boolean }) {
  const devMode = useDevMode();
  if (!devMode && !always) return null;
  const input = trace.steps.reduce((sum, step) => sum + step.inputTokens, 0);
  const output = trace.steps.reduce((sum, step) => sum + step.outputTokens, 0);
  const color = (step: AssistantTrace['steps'][number]) =>
    step.status === 'failed'
      ? 'var(--red)'
      : step.status === 'off'
        ? 'var(--gray)'
        : ENGINE_COLOR[step.engine];

  return (
    <div className='text-label-3 numeric font-mono text-[10.5px] tracking-[0.03em]'>
      <div className='flex h-[5px] gap-[2px] overflow-hidden rounded-full'>
        {trace.steps.map((step, index) => (
          <i
            key={index}
            className='block h-full'
            style={{ flexGrow: Math.max(step.ms, 40), background: color(step) }}
          />
        ))}
      </div>
      <div className='mt-1 flex flex-wrap justify-between gap-x-3'>
        <span>
          {trace.steps
            .map(
              (step) =>
                `${ENGINE_SHORT[step.engine].toUpperCase()} ${secondsLabel(step.ms).replace(' ', '')}`
            )
            .join(' · ')}
        </span>
        <span>
          {tokens(input)}
          {output > 0 && `→${tokens(output)}`} TOK · {usd(trace.costMicros)}
        </span>
      </div>
      {trace.steps.some((step) => step.detail || step.status !== 'ok') && (
        <div className='mt-1 space-y-0.5'>
          {trace.steps.map(
            (step, index) =>
              (step.detail || step.status !== 'ok') && (
                <p key={index}>
                  <span className='font-semibold' style={{ color: color(step) }}>
                    {ENGINE_LABELS[step.engine]}
                  </span>
                  {step.status === 'off'
                    ? ' · desligado (sem chave)'
                    : [
                        step.status === 'failed' ? 'falhou' : null,
                        step.detail,
                        usd(step.costMicros),
                      ]
                        .filter(Boolean)
                        .map((part) => ` · ${part}`)
                        .join('')}
                </p>
              )
          )}
        </div>
      )}
    </div>
  );
}
