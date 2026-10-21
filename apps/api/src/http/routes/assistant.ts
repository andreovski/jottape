import {
  assistantFeedbackBodySchema,
  assistantMessageBodySchema,
  createAssistantTestCaseBodySchema,
  saveAssistantCardBodySchema,
  updateAssistantTestCaseBodySchema,
  updateAssistantUserBodySchema,
} from '@jottape/schemas';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppError } from '@/lib/errors';
import {
  assistantState,
  clearConversation,
  discardCard,
  reportMessage,
  saveCard,
  sendMessage,
  transcribeAudio,
  undoCard,
} from '@/services/assistant';
import {
  adminOverview,
  benchmark,
  createTestCase,
  deleteTestCase,
  exportAdmin,
  resolveFeedback,
  updateAssistantUser,
  updateTestCase,
} from '@/services/assistant/admin';
import { AUDIO_TYPES } from '@/services/assistant/transcribe';

import { authenticate } from '../session';

const idParams = z.object({ id: z.string().uuid() });
/** Uns 60 s de áudio comprimido cabem com folga. */
const AUDIO_LIMIT = 8 * 1024 * 1024;

/** Jotta (o Assistente): o chat que vira lançamentos. */
export async function assistantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // O áudio chega cru no corpo (Content-Type do MediaRecorder), sem multipart.
  app.addContentTypeParser(
    /^audio\//,
    { parseAs: 'buffer', bodyLimit: AUDIO_LIMIT },
    (_request, body, done) => done(null, body)
  );

  app.get('/assistant', async (request) => assistantState(request.userId));

  app.post('/assistant/messages', async (request) => {
    const { text, voiceSeconds } = assistantMessageBodySchema.parse(request.body);
    return sendMessage(
      request.userId,
      text,
      { warn: (error, message) => request.log.warn({ err: error }, message) },
      { voiceSeconds }
    );
  });

  app.delete('/assistant/messages', async (request, reply) => {
    await clearConversation(request.userId);
    return reply.status(204).send();
  });

  app.post('/assistant/transcriptions', async (request) => {
    const contentType = request.headers['content-type'] ?? '';
    if (!AUDIO_TYPES.includes(contentType.split(';')[0].trim()) || !Buffer.isBuffer(request.body)) {
      throw new AppError(415, 'Formato de áudio não suportado.');
    }
    if (request.body.length === 0) throw new AppError(400, 'O áudio veio vazio.');
    const seconds = Number(request.headers['x-audio-seconds']) || 0;
    try {
      return { text: await transcribeAudio(request.userId, request.body, contentType, seconds) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      request.log.warn({ err: error }, 'transcrição falhou');
      throw new AppError(502, 'Não consegui entender o áudio. Tente de novo ou escreva o pedido.');
    }
  });

  app.post('/assistant/cards/:id/save', async (request) => {
    const { id } = idParams.parse(request.params);
    return saveCard(request.userId, id, saveAssistantCardBodySchema.parse(request.body ?? {}));
  });

  app.post('/assistant/cards/:id/undo', async (request) => {
    const { id } = idParams.parse(request.params);
    return undoCard(request.userId, id);
  });

  app.post('/assistant/cards/:id/discard', async (request) => {
    const { id } = idParams.parse(request.params);
    return discardCard(request.userId, id);
  });

  app.post('/assistant/messages/:id/feedback', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await reportMessage(request.userId, id, assistantFeedbackBodySchema.parse(request.body ?? {}));
    return reply.status(204).send();
  });

  // Painel do beta: só o dono.
  app.get('/assistant/admin', async (request) => adminOverview(request.userId));

  app.patch('/assistant/admin/users/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return updateAssistantUser(
      request.userId,
      id,
      updateAssistantUserBodySchema.parse(request.body)
    );
  });

  app.post('/assistant/admin/feedback/:id/resolve', async (request) => {
    const { id } = idParams.parse(request.params);
    const { resolved } = z.object({ resolved: z.boolean() }).parse(request.body ?? {});
    return resolveFeedback(request.userId, id, resolved);
  });

  app.post('/assistant/admin/benchmark', async (request) => benchmark(request.userId));

  app.get('/assistant/admin/export', async (request, reply) => {
    const data = await exportAdmin(request.userId);
    return reply
      .header('content-disposition', `attachment; filename="jotta-relatos-${data.month}.json"`)
      .send(data);
  });

  app.post('/assistant/admin/cases', async (request) =>
    createTestCase(request.userId, createAssistantTestCaseBodySchema.parse(request.body))
  );

  app.patch('/assistant/admin/cases/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return updateTestCase(
      request.userId,
      id,
      updateAssistantTestCaseBodySchema.parse(request.body)
    );
  });

  app.delete('/assistant/admin/cases/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return deleteTestCase(request.userId, id);
  });
}
