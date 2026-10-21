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

export const bankMovementResponseSchema = z.object({
  id: z.string(),
  bankAccountId: z.string(),
  /** Conta do Jottape onde o lançamento entra. */
  accountId: z.string().nullable(),
  kind: z.enum(['INCOME', 'EXPENSE']),
  amountCents: z.number().int(),
  date: isoDateSchema,
  description: z.string(),
  installmentNumber: z.number().int().nullable(),
  installmentTotal: z.number().int().nullable(),
  status: bankMovementStatusSchema,
  suggestedCategoryId: z.string().nullable(),
  transactionId: z.string().nullable(),
});
export type BankMovementResponse = z.infer<typeof bankMovementResponseSchema>;

export const acceptBankMovementBodySchema = z.object({
  kind: z.enum(['INCOME', 'EXPENSE']).optional(),
  categoryId: idSchema.nullable().optional(),
  description: z.string().trim().min(1, 'Informe a descrição.').max(120).optional(),
});
export type AcceptBankMovementBody = z.infer<typeof acceptBankMovementBodySchema>;
