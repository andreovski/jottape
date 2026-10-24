import { z } from 'zod';

// Resposta de GET /health: o Railway só considera o deploy no ar com 200, e o web mostra o
// estado da API nos Ajustes.
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['ok', 'unavailable']),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
