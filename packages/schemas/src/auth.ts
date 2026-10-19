import { z } from 'zod';

export const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  password: z.string().min(1, 'Informe a senha.'),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

/** Cadastro de um novo usuário: só com o código de convite (`SIGNUP_CODE` na API). */
export const registerBodySchema = z.object({
  name: z.string().trim().min(1, 'Informe o seu nome.').max(80),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(254),
  // O bcrypt só lê 72 bytes.
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.').max(72),
  inviteCode: z.string().trim().min(1, 'Informe o código de convite.').max(200),
  /** Fuso do aparelho (`Intl`), para "hoje" já começar certo. */
  timezone: z.string().min(1).max(64).optional(),
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const meResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  hasPassword: z.boolean(),
  googleLinked: z.boolean(),
  timezone: z.string(),
  currency: z.string(),
  weekStartsOn: z.number().int().min(0).max(6),
  defaultReminderMin: z.number().int().nullable(),
  dailySummaryHour: z.number().int().min(0).max(23).nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateProfileBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    timezone: z.string().min(1),
    weekStartsOn: z.number().int().min(0).max(6),
    defaultReminderMin: z.number().int().min(0).max(10080).nullable(),
    dailySummaryHour: z.number().int().min(0).max(23).nullable(),
  })
  .partial();
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

export const changePasswordBodySchema = z.object({
  // Opcional só para quem nunca teve senha (entrou sempre com Google).
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.').max(200),
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
