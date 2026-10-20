import { z } from 'zod';

import { idSchema, isoDateSchema, isoDateTimeSchema } from './common';
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
});
export type AssistantEventDraft = z.infer<typeof assistantEventDraftSchema>;

/** Tarefa. Sem lista, vai para a Entrada; sem data, fica sem prazo. */
export const assistantTaskDraftSchema = z.object({
  type: z.literal('task'),
  title: z.string().max(300),
  date: isoDateSchema.nullable(),
  time: timeSchema.nullable(),
  listId: idSchema.nullable(),
});
export type AssistantTaskDraft = z.infer<typeof assistantTaskDraftSchema>;

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

export const assistantMessageResponseSchema = z.object({
  id: z.string(),
  role: z.enum(['USER', 'ASSISTANT']),
  /** `{0}`, `{1}`... marcam valores em dinheiro (em `values`, centavos), para o app poder ocultar. */
  text: z.string(),
  values: z.array(z.number().int()),
  cards: z.array(assistantCardResponseSchema),
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
});
export type SaveAssistantCardBody = z.infer<typeof saveAssistantCardBodySchema>;

export const transcriptionResponseSchema = z.object({ text: z.string() });
export type TranscriptionResponse = z.infer<typeof transcriptionResponseSchema>;
