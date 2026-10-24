import { z } from 'zod';

import { idSchema, isoDateSchema, isoDateTimeSchema, rruleSchema } from './common';
import { createEventBodySchema, eventResponseSchema } from './events';
import { createTaskBodySchema, type TaskResponse } from './tasks';
import {
  createTransactionBodySchema,
  transactionKindSchema,
  transactionResponseSchema,
} from './transactions';

// Assistente: chat que transforma um pedido em texto (digitado ou ditado) em lançamento, evento
// ou tarefa.

export const assistantMessageBodySchema = z.object({
  text: z.string().trim().min(1, 'Escreva o pedido.').max(1000),
  /** Pedido ditado: segundos de fala. */
  voiceSeconds: z.number().min(0).max(600).optional(),
});
export type AssistantMessageBody = z.infer<typeof assistantMessageBodySchema>;

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (HH:MM).');

/** Lançamento que o Assistente montou. Segue o corpo de POST /transactions, com o que faltar nulo. */
export const assistantTransactionDraftSchema = z.object({
  type: z.literal('transaction'),
  kind: transactionKindSchema,
  amountCents: z.number().int().positive().nullable(),
  date: isoDateSchema,
  accountId: idSchema.nullable(),
  toAccountId: idSchema.nullable(),
  categoryId: idSchema.nullable(),
  description: z.string().max(120),
  installments: z.number().int().min(2).max(72).nullable(),
});
export type AssistantTransactionDraft = z.infer<typeof assistantTransactionDraftSchema>;

/** Evento na agenda, no relógio do usuário. Sem horário (e sem ser o dia todo), falta o horário. */
export const assistantEventDraftSchema = z.object({
  type: z.literal('event'),
  title: z.string().max(200),
  date: isoDateSchema,
  startTime: timeSchema.nullable(),
  endTime: timeSchema.nullable(),
  allDay: z.boolean(),
  location: z.string().max(300).nullable(),
  /** O que o pedido mandou anotar ("nas notas coloque..."); vai na descrição do evento. */
  notes: z.string().max(2000).nullable().default(null),
  /** Repetição ("toda segunda"), como na tela da Agenda. */
  rrule: rruleSchema.nullable().default(null),
});
export type AssistantEventDraft = z.infer<typeof assistantEventDraftSchema>;

/** Tarefa. Sem lista, vai para a Entrada; sem data, fica sem prazo. */
export const assistantTaskDraftSchema = z.object({
  type: z.literal('task'),
  title: z.string().max(300),
  date: isoDateSchema.nullable(),
  time: timeSchema.nullable(),
  listId: idSchema.nullable(),
  notes: z.string().max(2000).nullable().default(null),
  /** Repetição ("todo dia", "terça e quinta"); tarefa que repete sempre tem data. */
  rrule: rruleSchema.nullable().default(null),
  /** Itens da tarefa ("manhã: alimentação, noite: alimentação"), criados como subtarefas. */
  subtasks: z.array(z.string().max(300)).max(20).default([]),
});
export type AssistantTaskDraft = z.infer<typeof assistantTaskDraftSchema>;

const changeValueSchema = z.union([z.string(), z.number(), z.null()]);

/**
 * Mudar, apagar ou concluir algo que já existe ("o uber de ontem foi 35", "apaga o dentista").
 * `apply` é o corpo que vai para o serviço da tela; `revert`, o que desfaz (null: apagar não volta).
 */
export const assistantChangeDraftSchema = z.object({
  type: z.literal('change'),
  target: z.enum(['transaction', 'event', 'task']),
  targetId: z.string(),
  action: z.enum(['update', 'delete', 'complete']),
  /** Como o item está hoje, para o cartão. */
  title: z.string(),
  date: z.string().nullable(),
  amountCents: z.number().int().nullable(),
  /** O que muda, campo a campo. Datas AAAA-MM-DD, horas HH:MM, valor em centavos. */
  diffs: z.array(
    z.object({
      field: z.enum([
        'description',
        'amount',
        'date',
        'category',
        'account',
        'title',
        'start',
        'end',
        'location',
        'due',
      ]),
      before: changeValueSchema,
      after: changeValueSchema,
    })
  ),
  apply: z.record(z.unknown()),
  revert: z.record(z.unknown()).nullable(),
});
export type AssistantChangeDraft = z.infer<typeof assistantChangeDraftSchema>;

export const assistantDraftSchema = z.preprocess(
  // Os primeiros rascunhos (só lançamentos) não tinham o tipo.
  (value) =>
    value && typeof value === 'object' && !('type' in value)
      ? { ...value, type: 'transaction' }
      : value,
  z.discriminatedUnion('type', [
    assistantTransactionDraftSchema,
    assistantEventDraftSchema,
    assistantTaskDraftSchema,
    assistantChangeDraftSchema,
  ])
);
export type AssistantDraft = z.infer<typeof assistantDraftSchema>;

/** O que falta para salvar (sem isso o lançamento não existe). */
export const assistantMissingSchema = z.enum(['amount', 'account', 'toAccount', 'time']);
export type AssistantMissing = z.infer<typeof assistantMissingSchema>;

/** Campos preenchidos com pouca certeza: a tela os destaca. */
export const assistantUncertainSchema = z.enum([
  'kind',
  'account',
  'toAccount',
  'category',
  'list',
]);
export type AssistantUncertain = z.infer<typeof assistantUncertainSchema>;

export const assistantCardStatusSchema = z.enum(['DRAFT', 'SAVED', 'UNDONE', 'DISCARDED']);
export type AssistantCardStatus = z.infer<typeof assistantCardStatusSchema>;

export const assistantCardResponseSchema = z.object({
  id: z.string(),
  status: assistantCardStatusSchema,
  /** De 0 a 1: com score alto e nada faltando, o Assistente salva sozinho. */
  score: z.number(),
  draft: assistantDraftSchema,
  missing: z.array(assistantMissingSchema),
  uncertain: z.array(assistantUncertainSchema),
  /** Os lançamentos criados (um, ou as parcelas), enquanto existirem. */
  transactions: z.array(transactionResponseSchema),
  /** O evento ou a tarefa criados, enquanto existirem. */
  event: eventResponseSchema.nullable(),
  task: z.custom<TaskResponse>().nullable(),
});
export type AssistantCardResponse = z.infer<typeof assistantCardResponseSchema>;

/** Um passo do pedido, para o modo dev: quem rodou, quanto levou e quanto custou. */
export const assistantTraceStepSchema = z.object({
  /** haiku: leitura; jev: conferência de um item; answer: resposta; change: achar o que mudar. */
  engine: z.enum(['haiku', 'jev', 'answer', 'change']),
  /** off: o serviço não está configurado (sem a chave). */
  status: z.enum(['ok', 'failed', 'off']),
  ms: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  /** Custo estimado em milionésimos de dólar. */
  costMicros: z.number().int(),
  /** O que saiu do passo, em poucas palavras ("despesa 97%", "lancamentos, contas"). */
  detail: z.string().nullable(),
  /** Por que falhou, em poucas palavras (o erro do serviço). */
  error: z.string().nullable().optional(),
});
export type AssistantTraceStep = z.infer<typeof assistantTraceStepSchema>;

export const assistantTraceSchema = z.object({
  steps: z.array(assistantTraceStepSchema),
  costMicros: z.number().int(),
});
export type AssistantTrace = z.infer<typeof assistantTraceSchema>;

export const assistantMessageResponseSchema = z.object({
  id: z.string(),
  role: z.enum(['USER', 'ASSISTANT']),
  /** `{0}`, `{1}`... marcam valores em dinheiro (em `values`, centavos), para o app poder ocultar. */
  text: z.string(),
  values: z.array(z.number().int()),
  cards: z.array(assistantCardResponseSchema),
  /** O que rodou na resposta. Só vai para o dono (modo dev); para os outros, null. */
  trace: assistantTraceSchema.nullable(),
  /** O usuário já tocou em "Isso está errado" nesta resposta. */
  reported: z.boolean(),
  /** Pedido ditado: segundos de fala; digitado (ou resposta): null. */
  voiceSeconds: z.number().int().nullable(),
  createdAt: isoDateTimeSchema,
});
export type AssistantMessageResponse = z.infer<typeof assistantMessageResponseSchema>;

export const assistantUsageResponseSchema = z.object({
  used: z.number().int(),
  /** Sem limite (o dono do app): null. */
  limit: z.number().int().nullable(),
});
export type AssistantUsageResponse = z.infer<typeof assistantUsageResponseSchema>;

export const assistantStateResponseSchema = z.object({
  /** Sem a chave da Anthropic no servidor, o Assistente fica escondido. */
  enabled: z.boolean(),
  /** O servidor transcreve áudio; sem isso, o app usa o reconhecimento de voz do navegador. */
  transcription: z.boolean(),
  /** O modo dev pode ser ligado (só o dono do app). */
  devMode: z.boolean(),
  /** O painel do beta (só o dono do app). */
  admin: z.boolean(),
  usage: assistantUsageResponseSchema,
  messages: z.array(assistantMessageResponseSchema),
});
export type AssistantStateResponse = z.infer<typeof assistantStateResponseSchema>;

export const assistantReplyResponseSchema = z.object({
  messages: z.array(assistantMessageResponseSchema),
  usage: assistantUsageResponseSchema,
});
export type AssistantReplyResponse = z.infer<typeof assistantReplyResponseSchema>;

/**
 * Salvar um rascunho, com o que o usuário mudou: `draft` quando escolheu a conta num botão do
 * cartão; `transaction`, `event` ou `task` quando abriu a folha (vale o que estiver nela).
 */
export const saveAssistantCardBodySchema = z.object({
  draft: z
    .object({
      accountId: idSchema,
      toAccountId: idSchema,
      amountCents: z.number().int().positive(),
      installments: z.number().int().min(2).max(72).nullable(),
    })
    .partial()
    .optional(),
  transaction: createTransactionBodySchema.optional(),
  event: createEventBodySchema.optional(),
  task: createTaskBodySchema.optional(),
  /** Subtarefas da folha da tarefa (sem elas, as do rascunho). */
  subtasks: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
});
export type SaveAssistantCardBody = z.infer<typeof saveAssistantCardBodySchema>;

export const transcriptionResponseSchema = z.object({ text: z.string() });
export type TranscriptionResponse = z.infer<typeof transcriptionResponseSchema>;

// ---------------------------------------------------------------- beta

/** "Isso está errado" numa resposta, com um comentário opcional. */
export const assistantFeedbackBodySchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
});
export type AssistantFeedbackBody = z.infer<typeof assistantFeedbackBodySchema>;

/** De onde vem o acesso ao Assistente: dono, ASSISTANT_EMAILS, convite pelo painel, ou nenhum. */
export const assistantAccessSchema = z.enum(['owner', 'env', 'app', 'none']);
export type AssistantAccess = z.infer<typeof assistantAccessSchema>;

export const assistantAdminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  access: assistantAccessSchema,
  /** Pedidos por mês que valem para ele (null: sem limite, o dono). */
  limit: z.number().int().nullable(),
  /** O limite próprio, quando o dono mudou; null usa o padrão. */
  customLimit: z.number().int().nullable(),
  /** Mês corrente (do uso, que não some). */
  month: z.object({
    requests: z.number().int(),
    transcriptions: z.number().int(),
    audioSeconds: z.number(),
    costMicros: z.number().int(),
  }),
  /** Últimos 30 dias (a conversa some depois disso). */
  recent: z.object({
    cards: z.number().int(),
    autoSaved: z.number().int(),
    saved: z.number().int(),
    edited: z.number().int(),
    undone: z.number().int(),
    discarded: z.number().int(),
    pending: z.number().int(),
    haikuFailed: z.number().int(),
    jevFailed: z.number().int(),
    answerFailed: z.number().int(),
    reports: z.number().int(),
  }),
  /** Campos trocados antes de salvar, com quantas vezes ("account": 3). Só a contagem. */
  corrections: z.record(z.number().int()),
  /** As últimas falhas, com o erro (sem o pedido). */
  failures: z.array(
    z.object({
      engine: z.enum(['haiku', 'jev', 'answer', 'change']),
      error: z.string().nullable(),
      at: isoDateTimeSchema,
    })
  ),
});
export type AssistantAdminUser = z.infer<typeof assistantAdminUserSchema>;

export const assistantIntentSchema = z.enum([
  'expense',
  'income',
  'transfer',
  'event',
  'task',
  'question',
  'change',
  'other',
]);
export type AssistantIntent = z.infer<typeof assistantIntentSchema>;

/**
 * O que o primeiro item do pedido precisa ter, por nome (conta, categoria, lista). Campo ausente
 * não é conferido; `notes` diz se o item deve vir com notas.
 */
export const assistantTestExpectSchema = z.object({
  intents: z.array(assistantIntentSchema).min(1).max(10),
  amountCents: z.number().int().positive().optional(),
  date: isoDateSchema.nullable().optional(),
  account: z.string().max(120).optional(),
  toAccount: z.string().max(120).optional(),
  category: z.string().max(120).optional(),
  installments: z.number().int().min(2).max(72).optional(),
  time: timeSchema.nullable().optional(),
  endTime: timeSchema.optional(),
  allDay: z.boolean().optional(),
  list: z.string().max(120).optional(),
  notes: z.boolean().optional(),
  /** A regra de repetição esperada ("FREQ=DAILY"); null espera sem repetição. */
  repeat: rruleSchema.nullable().optional(),
  /** Quantas subtarefas a tarefa deve ter. */
  subtasks: z.number().int().min(0).max(20).optional(),
});
export type AssistantTestExpect = z.infer<typeof assistantTestExpectSchema>;

/** Contas, categorias e listas do usuário naquele dia (só nome e tipo). */
export const assistantTestContextSchema = z.object({
  accounts: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['WALLET', 'CHECKING', 'SAVINGS', 'CREDIT_CARD']),
    })
  ),
  categories: z.array(z.object({ name: z.string(), kind: z.enum(['INCOME', 'EXPENSE']) })),
  lists: z.array(z.object({ name: z.string() })),
  /** O que o Jotta tinha aprendido da pessoa naquele dia (descrição → conta ou categoria). */
  memory: z
    .array(
      z.object({ label: z.string(), field: z.enum(['account', 'category']), value: z.string() })
    )
    .optional(),
});
export type AssistantTestContext = z.infer<typeof assistantTestContextSchema>;

export const createAssistantTestCaseBodySchema = z.object({
  feedbackId: idSchema.nullable().optional(),
  text: z.string().trim().min(1).max(1000),
  today: isoDateSchema,
  timezone: z.string().min(1).max(64),
  context: assistantTestContextSchema,
  expect: assistantTestExpectSchema,
});
export type CreateAssistantTestCaseBody = z.infer<typeof createAssistantTestCaseBodySchema>;

export const updateAssistantTestCaseBodySchema = z.object({
  active: z.boolean().optional(),
  text: z.string().trim().min(1).max(1000).optional(),
  expect: assistantTestExpectSchema.optional(),
});
export type UpdateAssistantTestCaseBody = z.infer<typeof updateAssistantTestCaseBodySchema>;

export const assistantTestCaseSchema = createAssistantTestCaseBodySchema.extend({
  id: z.string(),
  feedbackId: z.string().nullable(),
  active: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type AssistantTestCase = z.infer<typeof assistantTestCaseSchema>;

export const assistantFeedbackItemSchema = z.object({
  id: z.string(),
  userName: z.string(),
  request: z.string(),
  /** Como a resposta: `{n}` + `values`. */
  reply: z.string(),
  values: z.array(z.number().int()),
  trace: assistantTraceSchema.nullable(),
  cards: z.array(assistantDraftSchema),
  note: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.nullable(),
  /** O caso de teste que saiu deste relato. */
  testCaseId: z.string().nullable(),
  /** O caso já preenchido com o que o cartão virou, para o dono conferir e salvar. */
  suggestedCase: createAssistantTestCaseBodySchema,
});
export type AssistantFeedbackItem = z.infer<typeof assistantFeedbackItemSchema>;

export const assistantAdminResponseSchema = z.object({
  month: z.string(),
  defaultLimit: z.number().int(),
  services: z.object({ jev: z.boolean(), transcription: z.boolean() }),
  users: z.array(assistantAdminUserSchema),
  /** Relatos em aberto primeiro, os mais novos. */
  feedback: z.array(assistantFeedbackItemSchema),
  testCases: z.array(assistantTestCaseSchema),
  /** As últimas rodadas do teste de acerto (painel e CI), a mais nova primeiro. */
  runs: z.array(z.lazy(() => assistantBenchmarkRunSchema)),
});
export type AssistantAdminResponse = z.infer<typeof assistantAdminResponseSchema>;

export const updateAssistantUserBodySchema = z.object({
  access: z.boolean().optional(),
  limit: z.number().int().min(1).max(10_000).nullable().optional(),
});
export type UpdateAssistantUserBody = z.infer<typeof updateAssistantUserBodySchema>;

export const assistantBenchmarkCaseSchema = z.object({
  text: z.string(),
  passed: z.boolean(),
  /** O que se esperava e o que veio, em poucas palavras. */
  expected: z.string(),
  got: z.string(),
  /** Os campos que não bateram. */
  problems: z.array(z.string()),
  /** Salvaria sozinho (score alto e nada faltando). */
  autoSave: z.boolean(),
  /** fixed: um dos 50 de exemplo; real: caso que veio de um relato. */
  source: z.enum(['fixed', 'real']),
  caseId: z.string().nullable(),
});
export type AssistantBenchmarkCase = z.infer<typeof assistantBenchmarkCaseSchema>;

export const assistantBenchmarkResponseSchema = z.object({
  ranAt: isoDateTimeSchema,
  total: z.number().int(),
  passed: z.number().int(),
  /** Acertos que salvariam sozinhos, e erros que salvariam sozinhos (os perigosos). */
  autoSavedRight: z.number().int(),
  autoSavedWrong: z.number().int(),
  ms: z.number().int(),
  costMicros: z.number().int(),
  cases: z.array(assistantBenchmarkCaseSchema),
});
export type AssistantBenchmarkResponse = z.infer<typeof assistantBenchmarkResponseSchema>;

/** Uma rodada guardada: pelo painel, ou pela CI num PR (com o commit e os casos que quebraram). */
export const assistantBenchmarkRunSchema = assistantBenchmarkResponseSchema.extend({
  id: z.string(),
  source: z.enum(['PANEL', 'CI']),
  commit: z.string().nullable(),
  label: z.string().nullable(),
  regressions: z.number().int(),
});
export type AssistantBenchmarkRun = z.infer<typeof assistantBenchmarkRunSchema>;

/** O que o job da CI manda ao terminar (POST /ci/assistant/runs, com o BENCH_TOKEN). */
export const ciBenchmarkRunBodySchema = z.object({
  commit: z.string().max(64),
  label: z.string().max(200).nullable(),
  regressions: z.number().int().min(0),
  result: assistantBenchmarkResponseSchema,
  usage: z.object({
    modelInput: z.number().int().min(0),
    modelOutput: z.number().int().min(0),
    jevInput: z.number().int().min(0),
  }),
});
export type CiBenchmarkRunBody = z.infer<typeof ciBenchmarkRunBodySchema>;

/** Uma preferência que o Jotta aprendeu: "iFood" vai no Cartão Nubank. */
export const assistantMemoryItemSchema = z.object({
  id: z.string(),
  /** A descrição como estava no cartão. */
  label: z.string(),
  field: z.enum(['account', 'category']),
  /** O nome da conta ou da categoria. */
  value: z.string(),
  uses: z.number().int(),
  updatedAt: isoDateTimeSchema,
});
export type AssistantMemoryItem = z.infer<typeof assistantMemoryItemSchema>;

export const assistantMemoryResponseSchema = z.object({
  items: z.array(assistantMemoryItemSchema),
});
export type AssistantMemoryResponse = z.infer<typeof assistantMemoryResponseSchema>;
