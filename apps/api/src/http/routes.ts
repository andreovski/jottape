import type { FastifyInstance } from 'fastify';

import { health } from './controllers/health';
import { agendaRoutes } from './routes/agenda';
import { authRoutes } from './routes/auth';
import { briefingRoutes } from './routes/briefing';
import { exportRoutes } from './routes/export';
import { financeRoutes } from './routes/finance';
import { googleRoutes } from './routes/google';
import { microsoftRoutes } from './routes/microsoft';
import { pushRoutes } from './routes/push';
import { taskRoutes } from './routes/tasks';

// As rotas não têm prefixo /api: o web repassa /api/* para cá tirando o prefixo
// (apps/web/server.mjs em produção, proxy do Vite em dev).
export async function appRoutes(app: FastifyInstance) {
  app.get('/health', health);

  app.register(authRoutes);
  app.register(googleRoutes);
  app.register(microsoftRoutes);
  app.register(pushRoutes);
  app.register(financeRoutes);
  app.register(agendaRoutes);
  app.register(taskRoutes);
  app.register(briefingRoutes);
  app.register(exportRoutes);
}
