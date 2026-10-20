import { z } from 'zod';

import { idSchema, isoDateSchema, isoDateTimeSchema } from './common';
import { transactionKindSchema, transactionResponseSchema } from './transactions';

// Assistente: chat que transforma um pedido em texto (digitado ou ditado) em lançamentos.

export const assistantMessageBodySchema = z.object({
  text: z.string().trim().min(1, 'Escreva o pedido.').max(1000),
});
export type AssistantMessageBody = z.infer<typeof assistantMessageBodySchema>;

/** Lançamento que o Assistente montou. Segue o corpo de POST /transactions, com o que faltar nulo. */
export const assistantDraftSchema = z.object({
  kind: transactionKindSchema,
  amountCents: z.number().int().positive().nullable(),
  date: isoDateSchema,
  accountId: idSchema.nullable(),
  toAccountId: idSchema.nullable(),
  categoryId: idSchema.nullable(),
  description: z.string().max(120),
  installments: z.number().int().min(2).max(72).nullable(),
});
export type AssistantDraft = z.infer<typeof assistantDraftSchema>;

/** O que falta para salvar (sem isso o lançamento não existe). */
export const assistantMissingSchema = z.enum(['amount', 'account', 'toAccount']);
export type AssistantMissing = z.infer<typeof assistantMissingSchema>;

/** Campos preenchidos com pouca certeza: a tela os destaca. */
export const assistantUncertainSchema = z.enum(['kind', 'account', 'toAccount', 'category']);
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
});
export type AssistantCardResponse = z.infer<typeof assistantCardResponseSchema>;

export const assistantMessageResponseSchema = z.object({
  id: z.string(),
  role: z.enum(['USER', 'ASSISTANT']),
  text: z.string(),
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

/** Salvar um rascunho, com o que o usuário mudou (escolheu a conta num botão, editou na folha). */
export const saveAssistantCardBodySchema = z.object({
  draft: assistantDraftSchema.partial().optional(),
});
export type SaveAssistantCardBody = z.infer<typeof saveAssistantCardBodySchema>;

export const transcriptionResponseSchema = z.object({ text: z.string() });
export type TranscriptionResponse = z.infer<typeof transcriptionResponseSchema>;
