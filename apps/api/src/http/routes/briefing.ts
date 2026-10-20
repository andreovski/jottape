import {
  briefingSettingsSchema,
  citySearchQuerySchema,
  nextEventQuerySchema,
  type NextEventResponse,
  stockLookupQuerySchema,
} from '@jottape/schemas';
import type { FastifyInstance } from 'fastify';

import { AppError } from '@/lib/errors';
import {
  buildBriefing,
  getBriefingSettings,
  nextEvent,
  saveBriefingSettings,
} from '@/services/briefing';
import { searchCities, stockQuote } from '@/services/briefing/external';

import { authenticate } from '../session';

/** O que a tela Hoje pede além da agenda do dia: o briefing e o próximo compromisso. */
export async function briefingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/briefing', async (request) =>
    buildBriefing(request.userId, {
      log: (error, plugin) => request.log.warn({ err: error, plugin }, 'plugin do briefing falhou'),
    })
  );

  app.get('/briefing/settings', async (request) => getBriefingSettings(request.userId));

  app.put('/briefing/settings', async (request) =>
    saveBriefingSettings(request.userId, briefingSettingsSchema.parse(request.body))
  );

  app.get('/briefing/cities', async (request) => {
    const { q } = citySearchQuerySchema.parse(request.query);
    try {
      return await searchCities(q);
    } catch (error) {
      request.log.warn({ err: error }, 'busca de cidade falhou');
      throw new AppError(502, 'A busca de cidades não respondeu. Tente de novo.');
    }
  });

  /** Confere o código antes de a ação entrar na lista. */
  app.get('/briefing/stocks', async (request) => {
    const { ticker } = stockLookupQuerySchema.parse(request.query);
    let quote;
    try {
      quote = await stockQuote(ticker);
    } catch (error) {
      request.log.warn({ err: error }, 'cotação de ação falhou');
      throw new AppError(502, 'A cotação não respondeu. Tente de novo.');
    }
    if (!quote) throw new AppError(404, `Não achamos a ação ${ticker}.`);
    return quote;
  });

  app.get('/events/next', async (request): Promise<NextEventResponse> => {
    const { from } = nextEventQuerySchema.parse(request.query);
    return { event: await nextEvent(request.userId, new Date(from)) };
  });
}
