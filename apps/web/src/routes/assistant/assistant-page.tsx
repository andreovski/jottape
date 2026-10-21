import type { AssistantMessageResponse, AssistantTrace } from '@jottape/schemas';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowUp, Mic, Sparkles, SquarePen, X } from 'lucide-react';
import { type FormEvent, Fragment, useEffect, useRef, useState } from 'react';

import { EmptyState, Skeleton, Spinner } from '@/components/ios/controls';
import { BarButton, Page } from '@/components/ios/page';
import { ActionSheet } from '@/components/ios/sheet';
import { fillValues } from '@/components/today/briefing-card';
import {
  useAssistant,
  useClearAssistant,
  useSendAssistantMessage,
  useTranscribe,
} from '@/features/assistant';
import { useAccounts, useCategories } from '@/features/finance';
import { useDevMode } from '@/lib/dev-mode';
import { usd } from '@/lib/format';
import { useHiddenMoney } from '@/lib/hidden-money';
import { cn } from '@/lib/utils';

import { AssistantCard } from './assistant-card';
import { MAX_SECONDS, useVoice, voiceMode } from './use-voice';

/** Exemplos acima do campo: mostram o que dá para pedir. */
const SUGGESTIONS = [
  'Gastei 32 reais no mercado',
  'Quanto gastei ontem com comida?',
  'Dentista amanhã às 15h',
  'Me lembra de pagar o IPVA sexta',
  'O que tenho amanhã?',
  'Almoço de 45 no crédito',
  'Reunião com a Ana segunda às 10h',
  'Recebi o salário de 5 mil',
  'Comprei um fone de 600 em 3x',
];

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

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

  function submit(value: string) {
    const trimmed = value.trim();
    if (!trimmed || thinking || atLimit) return;
    setText('');
    send.mutate(trimmed, { onError: () => setText(trimmed) });
  }

  const voice = useVoice({
    mode,
    onAudio: (audio, seconds) =>
      transcribe.mutate(
        { audio, seconds },
        {
          onSuccess: ({ text: heard }) => {
            if (heard) submit(heard);
          },
        }
      ),
    onText: (heard, final) => {
      if (final) submit(heard);
      else setText(heard);
    },
  });

  // Mensagem nova (ou "pensando"): rola até o fim, como no Mensagens.
  const pendingText = send.isPending ? send.variables : null;
  useEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pendingText, transcribe.isPending]);

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
      <Page title='Assistente'>
        <EmptyState
          icon={<Sparkles />}
          title='Assistente indisponível'
          message='O Assistente ainda não foi ligado neste servidor.'
        />
      </Page>
    );
  }

  const usage = data?.usage;

  return (
    <Page
      title='Assistente'
      actions={
        messages.length > 0 && (
          <BarButton label='Nova conversa' onClick={() => setMenu(true)}>
            <SquarePen strokeWidth={2.2} />
          </BarButton>
        )
      }
    >
      {state.isPending ? (
        <div className='space-y-3'>
          <Skeleton className='ml-auto h-10 w-2/3 rounded-[18px]' />
          <Skeleton className='h-16 w-full' />
        </div>
      ) : messages.length === 0 && !pendingText ? (
        <div className='flex flex-col items-center px-6 pt-6 pb-4 text-center'>
          <div className='bg-tint/15 text-tint mb-4 flex size-16 items-center justify-center rounded-full'>
            <Sparkles className='size-8' strokeWidth={1.75} />
          </div>
          <p className='text-body max-w-xs'>
            Conte o que gastou, o que tem marcado ou o que precisa fazer, do jeito que falaria. Eu
            monto o lançamento, o evento ou a tarefa e, quando tenho certeza, já salvo. Também
            respondo sobre seus gastos, saldos, agenda e tarefas.
          </p>
          <p className='text-footnote text-label-2 mt-2 max-w-xs'>
            Tudo que eu salvar pode ser desfeito na hora.
          </p>
        </div>
      ) : (
        <div className='space-y-3'>
          {messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              accounts={accounts}
              categories={categories}
            />
          ))}
          {pendingText && <Bubble mine>{pendingText}</Bubble>}
          {(send.isPending || transcribe.isPending) && (
            <div className='bg-surface text-label-2 inline-flex items-center gap-2 rounded-[18px] px-4 py-2.5'>
              <Spinner className='size-4' />
              <span className='text-subhead'>
                {transcribe.isPending ? 'Ouvindo o áudio…' : 'Pensando…'}
              </span>
            </div>
          )}
        </div>
      )}

      {usage && usage.limit !== null && (
        <p className='text-caption text-label-3 mt-5 text-center'>
          {atLimit
            ? `Você usou os ${usage.limit} pedidos do mês. O limite volta no dia 1º.`
            : `${usage.used} de ${usage.limit} pedidos este mês`}
        </p>
      )}

      {/* Espaço para o campo fixo embaixo. */}
      <div aria-hidden className='h-36' />

      <div className='fixed inset-x-0 bottom-[calc(50px+env(safe-area-inset-bottom))] z-30 lg:bottom-0 lg:left-64'>
        <div className='bottom-scrim pointer-events-none absolute inset-x-0 -top-6 bottom-0' />
        <div className='relative mx-auto max-w-3xl px-4 pb-3 lg:px-8 lg:pb-6'>
          {!voice.listening && !text && (
            <div className='no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4 lg:-mx-8 lg:px-8'>
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type='button'
                  className='bg-surface text-subhead shrink-0 rounded-full px-3.5 py-1.5 shadow-[inset_0_0_0_0.5px_var(--separator)] active:opacity-60'
                  onClick={() => setText(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {voice.listening ? (
            <div className='material bar-shadow flex h-[52px] items-center gap-3 rounded-full pr-1.5 pl-2'>
              <button
                type='button'
                aria-label='Cancelar'
                className='text-label-2 flex size-10 items-center justify-center rounded-full active:opacity-50'
                onClick={voice.cancel}
              >
                <X className='size-5' />
              </button>
              <span className='bg-red size-2.5 animate-pulse rounded-full' aria-hidden />
              <span className='text-body font-rounded numeric flex-1'>
                {mode === 'browser' && text ? (
                  <span className='text-subhead line-clamp-1'>{text}</span>
                ) : (
                  `${clock(voice.seconds)} / ${clock(MAX_SECONDS)}`
                )}
              </span>
              <button
                type='button'
                aria-label='Enviar áudio'
                className='bg-tint flex size-10 items-center justify-center rounded-full text-white active:opacity-70'
                onClick={voice.finish}
              >
                <ArrowUp className='size-5' strokeWidth={2.6} />
              </button>
            </div>
          ) : (
            <form
              onSubmit={onSubmit}
              className='material bar-shadow flex items-end gap-1.5 rounded-[26px] py-1.5 pr-1.5 pl-4'
            >
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
                  className='bg-tint flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-opacity active:opacity-70 disabled:opacity-30'
                >
                  <ArrowUp className='size-5' strokeWidth={2.6} />
                </button>
              ) : (
                <button
                  type='button'
                  aria-label='Ditar'
                  disabled={thinking || atLimit}
                  className='text-tint bg-tint/15 flex size-10 shrink-0 items-center justify-center rounded-full transition-opacity active:opacity-60 disabled:opacity-30'
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

function Bubble({ mine, children }: { mine?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex', mine && 'justify-end')}>
      <div
        className={cn(
          'text-body max-w-[85%] rounded-[18px] px-3.5 py-2 break-words whitespace-pre-wrap',
          mine ? 'bg-tint rounded-br-[6px] text-white' : 'bg-surface rounded-bl-[6px]'
        )}
      >
        {children}
      </div>
    </div>
  );
}

function Message({
  message,
  accounts,
  categories,
}: {
  message: AssistantMessageResponse;
  accounts: Parameters<typeof AssistantCard>[0]['accounts'];
  categories: Parameters<typeof AssistantCard>[0]['categories'];
}) {
  if (message.role === 'USER') return <Bubble mine>{message.text}</Bubble>;
  return (
    <div className='space-y-2'>
      <Bubble>
        <AnswerText text={message.text} values={message.values} />
      </Bubble>
      {message.trace && <TraceDetails trace={message.trace} />}
      {message.cards.map((card) => (
        <AssistantCard key={card.id} card={card} accounts={accounts} categories={categories} />
      ))}
    </div>
  );
}

/** Texto da resposta com os valores no lugar (ou ocultos, como no Hoje). */
function AnswerText({ text, values }: { text: string; values: number[] }) {
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

const ENGINE_LABELS: Record<AssistantTrace['steps'][number]['engine'], string> = {
  haiku: 'Haiku · leitura',
  jev: 'Jev',
  answer: 'Haiku · resposta',
};

const seconds = (ms: number) =>
  `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;

/** Modo dev: o que rodou nesta resposta, com tempo, tokens e custo. */
function TraceDetails({ trace }: { trace: AssistantTrace }) {
  const devMode = useDevMode();
  if (!devMode) return null;
  return (
    <div className='text-caption text-label-2 numeric space-y-0.5 px-3'>
      {trace.steps.map((step, index) => (
        <p key={index}>
          <span className={cn('font-semibold', step.status === 'failed' && 'text-red')}>
            {ENGINE_LABELS[step.engine]}
          </span>
          {step.status === 'off'
            ? ' · desligado (sem chave)'
            : [
                step.status === 'failed' ? 'falhou' : null,
                step.detail,
                seconds(step.ms),
                step.outputTokens
                  ? `${step.inputTokens.toLocaleString('pt-BR')} → ${step.outputTokens.toLocaleString('pt-BR')} tokens`
                  : `${step.inputTokens.toLocaleString('pt-BR')} tokens`,
                usd(step.costMicros),
              ]
                .filter(Boolean)
                .map((part) => ` · ${part}`)
                .join('')}
        </p>
      ))}
      <p className='font-semibold'>Total {usd(trace.costMicros)}</p>
    </div>
  );
}
