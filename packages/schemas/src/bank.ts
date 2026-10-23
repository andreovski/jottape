import { z } from 'zod';

import { idSchema, isoDateSchema } from './common';

// Bancos pelo Meu Pluggy: cada usuário cria a própria aplicação (grátis) no painel da Pluggy e cola
// as chaves aqui. A Pluggy entrega contas e lançamentos dos bancos conectados no Meu Pluggy.

export const saveBankCredentialsBodySchema = z.object({
  clientId: z.string().trim().min(1, 'Informe o Client ID.').max(200),
  clientSecret: z.string().trim().min(1, 'Informe o Client Secret.').max(500),
});
export type SaveBankCredentialsBody = z.infer<typeof saveBankCredentialsBodySchema>;

export const addBankItemBodySchema = z.object({
  itemId: z.string().trim().uuid('O ID do item é um código como 1a2b3c4d-....'),
});
export type AddBankItemBody = z.infer<typeof addBankItemBodySchema>;

/** Liga a conta do banco a uma conta do Jottape (ou cria uma), ou desliga (`accountId: null`). */
export const linkBankAccountBodySchema = z
  .object({
    accountId: idSchema.nullable().optional(),
    /** Cria uma conta (ou cartão) no Jottape com o nome e o saldo do banco. */
    create: z.boolean().optional(),
    /** Só lançamentos a partir deste dia. */
    importFrom: isoDateSchema.optional(),
  })
  .refine((value) => value.create || value.accountId !== undefined, {
    message: 'Escolha a conta do Jottape.',
    path: ['accountId'],
  });
export type LinkBankAccountBody = z.infer<typeof linkBankAccountBodySchema>;

export const bankAccountTypeSchema = z.enum(['BANK', 'CREDIT']);
export type BankAccountType = z.infer<typeof bankAccountTypeSchema>;

export const bankAccountResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.string().nullable(),
  /** BANK: conta corrente ou poupança. CREDIT: cartão de crédito. */
  type: bankAccountTypeSchema,
  /** Saldo no banco (no cartão, a fatura atual). */
  balanceCents: z.number().int(),
  accountId: z.string().nullable(),
  importFrom: isoDateSchema.nullable(),
  syncedAt: z.string().nullable(),
});
export type BankAccountResponse = z.infer<typeof bankAccountResponseSchema>;

export const bankItemResponseSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  status: z.string().nullable(),
  lastError: z.string().nullable(),
  syncedAt: z.string().nullable(),
  accounts: z.array(bankAccountResponseSchema),
});
export type BankItemResponse = z.infer<typeof bankItemResponseSchema>;

export const bankStatusResponseSchema = z.object({
  /** O usuário salvou as chaves da Pluggy. */
  configured: z.boolean(),
  /** Client ID salvo (não é segredo); o secret nunca volta. */
  clientId: z.string().nullable(),
  syncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  items: z.array(bankItemResponseSchema),
  /** Lançamentos do banco esperando revisão. */
  pendingCount: z.number().int(),
  /** Quando leu o aviso de privacidade (null = mostrar antes de tudo). */
  noticeAcceptedAt: z.string().nullable(),
});
export type BankStatusResponse = z.infer<typeof bankStatusResponseSchema>;

export const bankConnectTokenResponseSchema = z.object({
  accessToken: z.string(),
  /** Conector do Meu Pluggy, para o widget abrir direto nele (null = a lista toda). */
  connectorIds: z.array(z.number().int()).nullable(),
});
export type BankConnectTokenResponse = z.infer<typeof bankConnectTokenResponseSchema>;

export const bankMovementStatusSchema = z.enum(['PENDING', 'MATCHED', 'IMPORTED', 'IGNORED']);
export type BankMovementStatus = z.infer<typeof bankMovementStatusSchema>;

/** O que a IA fez com um lançamento do banco e quanto custou (só no modo dev do dono). */
export const bankAiTraceSchema = z.object({
  haiku: z.object({
    /** A categoria que o Haiku escolheu, pelo nome ("Transferência › Pix"). */
    pick: z.string().nullable(),
    /** O Haiku olha o lote inteiro: tokens do lote, custo da parte deste lançamento. */
    batchSize: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costMicros: z.number().int(),
    ms: z.number().int(),
  }),
  jev: z
    .object({
      top: z.string().nullable(),
      probability: z.number().nullable(),
      inputTokens: z.number().int(),
      costMicros: z.number().int(),
      ms: z.number().int(),
    })
    .nullable(),
  /** A IA decidiu (os dois concordaram com confiança). */
  decided: z.boolean(),
  costMicros: z.number().int(),
});
export type BankAiTrace = z.infer<typeof bankAiTraceSchema>;

export const bankMovementResponseSchema = z.object({
  id: z.string(),
  bankAccountId: z.string(),
  /** Conta do Jottape onde o lançamento entra. */
  accountId: z.string().nullable(),
  kind: z.enum(['INCOME', 'EXPENSE']),
  amountCents: z.number().int(),
  date: isoDateSchema,
  /** Título curto ("Josiane Cristina"). */
  description: z.string(),
  /** O texto como veio do banco (vai nas notas do lançamento quando difere do título). */
  bankDescription: z.string(),
  installmentNumber: z.number().int().nullable(),
  installmentTotal: z.number().int().nullable(),
  status: bankMovementStatusSchema,
  suggestedCategoryId: z.string().nullable(),
  /** De onde veio a sugestão: o histórico, a IA ou a regra fixa (Pix → Transferência › Pix). */
  suggestionSource: z.enum(['HISTORY', 'AI', 'RULE']).nullable(),
  /** Confiança da IA, de 0 a 1 (só quando a sugestão veio dela). */
  suggestionConfidence: z.number().nullable(),
  /** Só para o dono (modo dev). */
  aiTrace: bankAiTraceSchema.nullable().optional(),
  transactionId: z.string().nullable(),
});
export type BankMovementResponse = z.infer<typeof bankMovementResponseSchema>;

export const acceptBankMovementBodySchema = z.object({
  kind: z.enum(['INCOME', 'EXPENSE']).optional(),
  categoryId: idSchema.nullable().optional(),
  description: z.string().trim().min(1, 'Informe a descrição.').max(120).optional(),
  /** Sem vir, as notas levam o texto do banco (quando ele difere do título). */
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type AcceptBankMovementBody = z.infer<typeof acceptBankMovementBodySchema>;

// ---------------------------------------------------------------- beta

export const bankFeedbackBodySchema = z.object({
  note: z.string().trim().min(1, 'Conte o que veio errado.').max(2000),
  /** Lançamento da revisão de onde veio o relato. */
  movementId: idSchema.optional(),
});
export type BankFeedbackBody = z.infer<typeof bankFeedbackBodySchema>;

export const updateBankUserBodySchema = z.object({ bankAccess: z.boolean() });
export type UpdateBankUserBody = z.infer<typeof updateBankUserBodySchema>;

/** Até onde a pessoa chegou na configuração. */
export const bankStageSchema = z.enum(['none', 'keys', 'bank', 'linked', 'accepted']);
export type BankStage = z.infer<typeof bankStageSchema>;

export const bankAdminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  access: z.enum(['owner', 'app', 'none']),
  stage: bankStageSchema,
  banks: z.number().int(),
  linkedAccounts: z.number().int(),
  /** Lançamentos do banco dos últimos 30 dias, por destino. */
  last30: z.object({
    matched: z.number().int(),
    imported: z.number().int(),
    ignored: z.number().int(),
    pending: z.number().int(),
    edited: z.number().int(),
  }),
  /** Erros gravados agora (das chaves e de cada banco). */
  errors: z.array(z.string()),
  syncedAt: z.string().nullable(),
  /** Dias, em média, entre o lançamento no banco e a chegada no Jottape (30 dias). */
  lagDays: z.number().nullable(),
});
export type BankAdminUser = z.infer<typeof bankAdminUserSchema>;

export const bankAdminFeedbackSchema = z.object({
  id: z.string(),
  userName: z.string(),
  note: z.string(),
  snapshot: z.unknown(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type BankAdminFeedback = z.infer<typeof bankAdminFeedbackSchema>;

export const bankAdminResponseSchema = z.object({
  users: z.array(bankAdminUserSchema),
  feedback: z.array(bankAdminFeedbackSchema),
});
export type BankAdminResponse = z.infer<typeof bankAdminResponseSchema>;
