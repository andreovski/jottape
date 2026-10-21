import type {
  AccountResponse,
  AssistantAdminResponse,
  AssistantBenchmarkResponse,
  AssistantCardResponse,
  AssistantReplyResponse,
  AssistantStateResponse,
  TransactionResponse,
} from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { answerQuestion } from '@/services/assistant/answer';
import { buildChange, planChanges } from '@/services/assistant/change';
import { extractItems } from '@/services/assistant/haiku';
import { askJev } from '@/services/assistant/jev';
import { QUERY_HANDLERS } from '@/services/assistant/queries';
import type { ExtractedItem } from '@/services/assistant/resolve';
import { hashPassword } from '@/services/owner';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

// O Haiku e o Jev são de fora: o teste decide o que eles "responderam".
vi.mock('@/services/assistant/haiku', () => ({ extractItems: vi.fn() }));
vi.mock('@/services/assistant/jev', () => ({ askJev: vi.fn() }));
vi.mock('@/services/assistant/answer', () => ({ answerQuestion: vi.fn() }));
// A busca do item é do Haiku; a conferência da proposta (buildChange) é a de verdade.
vi.mock('@/services/assistant/change', async (original) => ({
  ...(await original<typeof import('@/services/assistant/change')>()),
  planChanges: vi.fn(),
}));

// 20/10/2026, 17:00 em São Paulo.
const NOW = new Date('2026-10-20T20:00:00Z');

function item(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    intent: 'expense',
    excerpt: 'gastei 32 no mercado',
    amountCents: 3200,
    description: 'Mercado',
    date: null,
    account: 'Nubank',
    toAccount: null,
    category: 'Mercado',
    installments: null,
    time: null,
    endTime: null,
    allDay: false,
    list: null,
    location: null,
    notes: null,
    confidence: 0.95,
    ...overrides,
  };
}

const sure = (choice: string) => ({ choice, probabilities: { [choice]: 0.98 } });

describe('assistente', () => {
  let api: ReturnType<typeof client>;
  let nubank: AccountResponse;
  let wallet: AccountResponse;
  let cookieHeader: string;

  beforeAll(() => app.ready());
  afterAll(() => app.close());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    vi.stubEnv('OWNER_EMAIL', '');
    vi.stubEnv('ASSISTANT_EMAILS', 'andre@example.com');
    vi.mocked(extractItems).mockReset();
    vi.mocked(askJev).mockReset();
    vi.mocked(answerQuestion).mockReset();
    vi.mocked(planChanges).mockReset();
    await resetDatabase();
    const login = await loginAsOwner(app);
    cookieHeader = login.cookie;
    api = client(app, login.cookie);
    nubank = (await api.post('/accounts', { name: 'Nubank', type: 'CHECKING' })).json();
    wallet = (await api.post('/accounts', { name: 'Carteira', type: 'WALLET' })).json();
  });

  const send = async (text: string, voiceSeconds?: number) => {
    const response = await api.post('/assistant/messages', { text, voiceSeconds });
    expect(response.statusCode).toBe(200);
    return response.json() as AssistantReplyResponse;
  };
  const transactions = async () =>
    (await api.get('/transactions?month=2026-10')).json() as TransactionResponse[];

  it('fica desligado sem a chave da Anthropic', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const state = (await api.get('/assistant')).json() as AssistantStateResponse;
    expect(state.enabled).toBe(false);
    expect((await api.post('/assistant/messages', { text: 'oi' })).statusCode).toBe(503);
  });

  it('só liga para o dono e os e-mails liberados', async () => {
    vi.stubEnv('ASSISTANT_EMAILS', 'outra@example.com');
    expect(((await api.get('/assistant')).json() as AssistantStateResponse).enabled).toBe(false);
    expect((await api.post('/assistant/messages', { text: 'oi' })).statusCode).toBe(503);

    vi.stubEnv('ASSISTANT_EMAILS', '');
    vi.stubEnv('OWNER_EMAIL', 'andre@example.com');
    expect(((await api.get('/assistant')).json() as AssistantStateResponse).enabled).toBe(true);
  });

  it('salva sozinho com score alto e desfaz', async () => {
    const mercado = await prisma.category.findFirstOrThrow({ where: { name: 'Mercado' } });
    const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    const categoryKey = `opcao_${categories.findIndex((c) => c.id === mercado.id) + 1}`;
    // A mesma ordem que o serviço manda ao Jev (por tipo: carteira antes de conta corrente).
    const accounts = await prisma.account.findMany({
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
    const accountKey = `opcao_${accounts.findIndex((a) => a.id === nubank.id) + 1}`;

    vi.mocked(extractItems).mockResolvedValue({
      items: [item()],
      inputTokens: 900,
      outputTokens: 80,
    });
    vi.mocked(askJev).mockResolvedValue({
      answers: { kind: sure('expense'), account: sure(accountKey), category: sure(categoryKey) },
      inputTokens: 400,
    });

    const reply = await send('gastei 32 no mercado no nubank', 3.4);
    expect(reply.messages.map((m) => m.role)).toEqual(['USER', 'ASSISTANT']);
    // Ditado: a linha do tempo mostra "voz · 3 s"; a resposta não tem.
    expect(reply.messages.map((m) => m.voiceSeconds)).toEqual([3, null]);
    const [card] = reply.messages[1].cards;
    expect(reply.messages[1].text).toBe('Pronto, salvei.');
    expect(card.status).toBe('SAVED');
    expect(card.transactions).toHaveLength(1);
    expect(card.transactions[0]).toMatchObject({
      kind: 'EXPENSE',
      amountCents: 3200,
      date: '2026-10-20',
      accountId: nubank.id,
      categoryId: mercado.id,
      status: 'DONE',
    });
    expect(reply.usage).toEqual({ used: 1, limit: 300 });

    const usage = await prisma.assistantUsage.findFirstOrThrow();
    expect(usage.costMicros).toBe(Math.round(900 * 0.1 + 80 * 0.5 + 400 * 0.042));

    const undone = (
      await api.post(`/assistant/cards/${card.id}/undo`)
    ).json() as AssistantCardResponse;
    expect(undone.status).toBe('UNDONE');
    expect(undone.transactions).toEqual([]);
    expect(await transactions()).toEqual([]);

    // A conversa volta com a tela.
    const state = (await api.get('/assistant')).json() as AssistantStateResponse;
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].cards[0].status).toBe('UNDONE');
  });

  it('deixa rascunho quando falta algo e salva com o que o usuário escolheu', async () => {
    vi.mocked(extractItems).mockResolvedValue({
      items: [item({ account: null, excerpt: 'paguei 50 de uber', description: 'Uber' })],
      inputTokens: 900,
      outputTokens: 80,
    });
    vi.mocked(askJev).mockResolvedValue({
      answers: { kind: sure('expense'), account: sure('nao_informada') },
      inputTokens: 300,
    });

    const reply = await send('paguei 50 de uber');
    const [card] = reply.messages[1].cards;
    expect(card.status).toBe('DRAFT');
    expect(card.missing).toEqual(['account']);
    expect(reply.messages[1].text).toBe('Falta a conta para salvar.');
    expect(await transactions()).toEqual([]);

    const incomplete = await api.post(`/assistant/cards/${card.id}/save`, {});
    expect(incomplete.statusCode).toBe(400);

    const saved = (
      await api.post(`/assistant/cards/${card.id}/save`, {
        draft: { accountId: wallet.id, installments: 2 },
      })
    ).json() as AssistantCardResponse;
    expect(saved.status).toBe('SAVED');
    expect(saved.missing).toEqual([]);
    expect(saved.transactions.map((t) => [t.accountId, t.amountCents])).toEqual([
      [wallet.id, 3200 / 2],
      [wallet.id, 3200 / 2],
    ]);
  });

  it('sem o Jev, mostra o rascunho em vez de salvar', async () => {
    vi.mocked(extractItems).mockResolvedValue({
      items: [
        item({ confidence: 1 }),
        item({ intent: 'question', excerpt: 'quanto gastei?', amountCents: null }),
      ],
      inputTokens: 900,
      outputTokens: 120,
    });
    vi.mocked(askJev).mockResolvedValue(null);
    vi.mocked(answerQuestion).mockResolvedValue({
      text: 'Neste mês, [[3200]].',
      inputTokens: 1,
      outputTokens: 1,
      tools: [],
    });

    const reply = await send('gastei 32 no mercado no nubank e quanto gastei no mês?');
    const cards = reply.messages[1].cards;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ status: 'DRAFT', score: 0.8, missing: [] });
    expect(reply.messages[1]).toMatchObject({
      text: 'Confira e salve. Neste mês, {0}.',
      values: [3200],
    });

    const discarded = (await api.post(`/assistant/cards/${cards[0].id}/discard`)).json();
    expect(discarded.status).toBe('DISCARDED');
    expect((await api.post(`/assistant/cards/${cards[0].id}/save`, {})).statusCode).toBe(409);
  });

  it('se o Haiku falhar, avisa e não conta no limite', async () => {
    vi.mocked(extractItems).mockRejectedValue(new Error('overloaded'));
    const reply = await send('gastei 10');
    expect(reply.messages[1].text).toMatch(/^Não consegui ler/);
    expect(reply.usage.used).toBe(0);
  });

  it('barra depois do limite do mês, menos para o dono', async () => {
    vi.stubEnv('ASSISTANT_MONTHLY_LIMIT', '1');
    vi.mocked(extractItems).mockResolvedValue({ items: [], inputTokens: 10, outputTokens: 10 });
    await send('oi');
    const blocked = await api.post('/assistant/messages', { text: 'oi de novo' });
    expect(blocked.statusCode).toBe(429);

    vi.stubEnv('OWNER_EMAIL', 'andre@example.com');
    const reply = await send('oi de novo');
    expect(reply.usage.limit).toBeNull();
  });

  it('não mexe nos cartões de outro usuário e limpa a conversa', async () => {
    vi.mocked(extractItems).mockResolvedValue({
      items: [item({ account: null })],
      inputTokens: 1,
      outputTokens: 1,
    });
    vi.mocked(askJev).mockResolvedValue(null);
    const [card] = (await send('gastei 32')).messages[1].cards;

    const other = await prisma.user.create({
      data: { email: 'outra@example.com', name: 'Outra', timezone: 'America/Sao_Paulo' },
    });
    await prisma.assistantCard.updateMany({ where: { id: card.id }, data: { userId: other.id } });
    expect((await api.post(`/assistant/cards/${card.id}/save`, {})).statusCode).toBe(404);

    expect((await api.delete('/assistant/messages')).statusCode).toBe(204);
    const state = (await api.get('/assistant')).json() as AssistantStateResponse;
    expect(state.messages).toEqual([]);
  });

  it('transcreve o áudio pela Groq e registra os segundos', async () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    const fetchMock = vi.fn(async () => Response.json({ text: ' gastei 20 no café ' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/assistant/transcriptions',
        headers: {
          cookie: cookieHeader,
          'content-type': 'audio/webm;codecs=opus',
          'x-audio-seconds': '6',
        },
        payload: Buffer.from('fake-audio'),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ text: 'gastei 20 no café' });
      expect(fetchMock).toHaveBeenCalledOnce();
      const usage = await prisma.assistantUsage.findFirstOrThrow();
      expect(usage).toMatchObject({ kind: 'TRANSCRIPTION', audioSeconds: 6, costMicros: 111 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('marca evento na agenda sozinho e desfaz', async () => {
    vi.mocked(extractItems).mockResolvedValue({
      items: [
        item({
          intent: 'event',
          excerpt: 'dentista amanhã às 15h',
          amountCents: null,
          description: 'Dentista',
          date: '2026-10-21',
          time: '15:00',
          account: null,
          category: null,
          notes: 'Levar os exames',
        }),
      ],
      inputTokens: 900,
      outputTokens: 80,
    });
    vi.mocked(askJev).mockResolvedValue({ answers: { kind: sure('event') }, inputTokens: 200 });

    const reply = await send('dentista amanhã às 15h');
    const [card] = reply.messages[1].cards;
    expect(reply.messages[1].text).toBe('Pronto, está na agenda.');
    expect(card.status).toBe('SAVED');
    expect(card.event).toMatchObject({
      title: 'Dentista',
      description: 'Levar os exames',
      allDay: false,
      // 15h em São Paulo (UTC-3).
      startAt: '2026-10-21T18:00:00.000Z',
      endAt: '2026-10-21T19:00:00.000Z',
    });
    expect(await prisma.event.count()).toBe(1);

    const undone = (
      await api.post(`/assistant/cards/${card.id}/undo`)
    ).json() as AssistantCardResponse;
    expect(undone.status).toBe('UNDONE');
    expect(undone.event).toBeNull();
    expect(await prisma.event.count()).toBe(0);
  });

  it('evento sem horário vira rascunho e salva com o que veio da folha', async () => {
    vi.mocked(extractItems).mockResolvedValue({
      items: [
        item({
          intent: 'event',
          excerpt: 'reunião sexta',
          amountCents: null,
          description: 'Reunião',
          date: '2026-10-23',
        }),
      ],
      inputTokens: 900,
      outputTokens: 80,
    });
    vi.mocked(askJev).mockResolvedValue({ answers: { kind: sure('event') }, inputTokens: 200 });

    const [card] = (await send('reunião sexta')).messages[1].cards;
    expect(card).toMatchObject({ status: 'DRAFT', missing: ['time'] });
    expect((await api.post(`/assistant/cards/${card.id}/save`, {})).statusCode).toBe(400);

    const saved = (
      await api.post(`/assistant/cards/${card.id}/save`, {
        event: {
          title: 'Reunião de equipe',
          startAt: '2026-10-23T13:00:00.000Z',
          endAt: '2026-10-23T14:00:00.000Z',
          allDay: false,
        },
      })
    ).json() as AssistantCardResponse;
    expect(saved.status).toBe('SAVED');
    expect(saved.event?.title).toBe('Reunião de equipe');
    // Completar o horário não é correção; trocar o título é.
    const row = await prisma.assistantCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(row).toMatchObject({ edited: true, corrections: ['title'] });
    expect(row.saved).toMatchObject({ event: { title: 'Reunião de equipe' } });
  });

  it('anota tarefa na lista com prazo e desfaz', async () => {
    const list = await prisma.taskList.create({
      data: { userId: (await prisma.user.findFirstOrThrow()).id, name: 'Casa' },
    });
    const lists = await prisma.taskList.findMany({
      where: { userId: list.userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    vi.mocked(extractItems).mockResolvedValue({
      items: [
        item({
          intent: 'task',
          excerpt: 'me lembra de trocar a lâmpada sexta',
          amountCents: null,
          description: 'Trocar a lâmpada',
          date: '2026-10-23',
          list: 'Casa',
          notes: 'A da cozinha',
        }),
      ],
      inputTokens: 900,
      outputTokens: 80,
    });
    vi.mocked(askJev).mockResolvedValue({
      answers: {
        kind: sure('task'),
        list: sure(`opcao_${lists.findIndex((l) => l.id === list.id) + 1}`),
      },
      inputTokens: 200,
    });

    const reply = await send('me lembra de trocar a lâmpada sexta');
    const [card] = reply.messages[1].cards;
    expect(reply.messages[1].text).toBe('Pronto, anotei nas tarefas.');
    expect(card.task).toMatchObject({
      title: 'Trocar a lâmpada',
      listId: list.id,
      notes: 'A da cozinha',
      hasTime: false,
      // Meia-noite de sexta em São Paulo.
      dueAt: '2026-10-23T03:00:00.000Z',
    });

    const undone = (
      await api.post(`/assistant/cards/${card.id}/undo`)
    ).json() as AssistantCardResponse;
    expect(undone.task).toBeNull();
    expect(await prisma.task.count({ where: { deletedAt: null } })).toBe(0);
  });

  it('responde pergunta consultando os lançamentos, com os valores à parte', async () => {
    const alimentacao = await prisma.category.findFirstOrThrow({ where: { name: 'Alimentação' } });
    const sub = await prisma.category.create({
      data: {
        userId: alimentacao.userId,
        name: 'Restaurantes',
        kind: 'EXPENSE',
        parentId: alimentacao.id,
      },
    });
    const post = (body: object) =>
      api.post('/transactions', { kind: 'EXPENSE', accountId: nubank.id, ...body });
    await post({ amountCents: 4000, date: '2026-10-19', description: 'iFood', categoryId: sub.id });
    await post({
      amountCents: 1500,
      date: '2026-10-19',
      description: 'Padaria',
      categoryId: alimentacao.id,
    });
    await post({ amountCents: 9900, date: '2026-10-18', description: 'Pizza', categoryId: sub.id });
    await post({ amountCents: 2500, date: '2026-10-19', description: 'Uber' });

    vi.mocked(extractItems).mockResolvedValue({
      items: [
        item({ intent: 'question', excerpt: 'quanto gastei ontem com comida', amountCents: null }),
      ],
      inputTokens: 700,
      outputTokens: 40,
    });
    vi.mocked(answerQuestion).mockImplementation(async (_text, ctx) => {
      const result = (await QUERY_HANDLERS.lancamentos(ctx, {
        de: '2026-10-19',
        ate: '2026-10-19',
        tipo: 'despesa',
        categorias: ['alimentacao'],
        contas: null,
        busca: null,
      })) as { despesas_realizadas_centavos: number; quantidade: number };
      expect(result.quantidade).toBe(2);
      return {
        text: `Ontem você gastou R$ [[${result.despesas_realizadas_centavos}]] com comida.`,
        inputTokens: 3000,
        outputTokens: 120,
        tools: ['lancamentos'],
      };
    });

    const reply = await send('quanto gastei ontem com comida?');
    expect(reply.messages[1]).toMatchObject({
      text: 'Ontem você gastou {0} com comida.',
      values: [5500],
      cards: [],
    });
    const usage = await prisma.assistantUsage.findFirstOrThrow();
    expect(usage.modelInputTokens).toBe(3700);

    // A próxima pergunta leva a conversa, com os valores como o modelo escreveu.
    vi.mocked(answerQuestion).mockResolvedValue({
      text: 'Anteontem, [[9900]].',
      inputTokens: 1,
      outputTokens: 1,
      tools: [],
    });
    await send('e anteontem?');
    const history = vi.mocked(answerQuestion).mock.calls[1][1].history;
    expect(history.at(-1)).toEqual({
      role: 'ASSISTANT',
      text: 'Ontem você gastou [[5500]] com comida.',
    });

    // Nome de categoria que não existe volta como erro para o modelo tentar de novo.
    const ctx = vi.mocked(answerQuestion).mock.calls[0][1];
    const wrong = (await QUERY_HANDLERS.lancamentos(ctx, {
      de: '2026-10-19',
      ate: '2026-10-19',
      tipo: 'despesa',
      categorias: ['Pets'],
      contas: null,
      busca: null,
    })) as { erro?: string };
    expect(wrong.erro).toBeTruthy();

    // As outras consultas respondem com os dados do usuário.
    await api.post('/events', {
      title: 'Dentista',
      startAt: '2026-10-21T18:00:00.000Z',
      endAt: '2026-10-21T19:00:00.000Z',
      allDay: false,
    });
    await api.post('/tasks', {
      title: 'Pagar o IPVA',
      dueAt: '2026-10-20T03:00:00.000Z',
      hasTime: false,
    });
    expect(await QUERY_HANDLERS.agenda(ctx, { de: '2026-10-21', ate: '2026-10-21' })).toMatchObject(
      {
        eventos: [{ titulo: 'Dentista', data: '2026-10-21', inicio: '15:00', fim: '16:00' }],
      }
    );
    expect(
      await QUERY_HANDLERS.tarefas(ctx, { visao: 'hoje', lista: null, busca: null })
    ).toMatchObject({
      tarefas: [{ titulo: 'Pagar o IPVA', prazo: '2026-10-20' }],
    });
    expect(await QUERY_HANDLERS.contas(ctx, {})).toMatchObject({
      saldo_total_centavos: -(4000 + 1500 + 9900 + 2500),
    });
    expect(await QUERY_HANDLERS.orcamentos(ctx, { mes: '2026-10' })).toEqual({
      mes: '2026-10',
      orcamentos: [],
    });
    expect(await QUERY_HANDLERS.previsao_saldo(ctx, { dias: 10 })).toMatchObject({
      primeiro_dia_negativo: '2026-10-20',
    });
  });

  it('pergunta que falhou responde que não conseguiu', async () => {
    vi.mocked(extractItems).mockResolvedValue({
      items: [item({ intent: 'question', amountCents: null })],
      inputTokens: 1,
      outputTokens: 1,
    });
    vi.mocked(answerQuestion).mockRejectedValue(new Error('fora do ar'));
    const reply = await send('quanto tenho no nubank?');
    expect(reply.messages[1].text).toMatch(/^Não consegui responder/);
    expect(reply.messages[1].values).toEqual([]);
  });

  it('mostra os passos e o custo só para o dono', async () => {
    vi.mocked(extractItems).mockResolvedValue({
      items: [item(), item({ intent: 'question', amountCents: null })],
      inputTokens: 1000,
      outputTokens: 100,
    });
    vi.mocked(askJev).mockResolvedValue({ answers: { kind: sure('expense') }, inputTokens: 500 });
    vi.mocked(answerQuestion).mockResolvedValue({
      text: 'Hoje, [[3200]].',
      inputTokens: 2000,
      outputTokens: 200,
      tools: ['lancamentos'],
    });

    // Beta (e-mail liberado): sem passos.
    let reply = await send('gastei 32 no mercado e quanto gastei hoje?');
    expect(reply.messages[1].trace).toBeNull();
    expect(((await api.get('/assistant')).json() as AssistantStateResponse).devMode).toBe(false);

    vi.stubEnv('OWNER_EMAIL', 'andre@example.com');
    vi.stubEnv('JEV_API_KEY', 'jev-test');
    reply = await send('gastei 32 no mercado e quanto gastei hoje?');
    const trace = reply.messages[1].trace!;
    expect(trace.steps.map((step) => [step.engine, step.status])).toEqual([
      ['haiku', 'ok'],
      ['jev', 'ok'],
      ['answer', 'ok'],
    ]);
    expect(trace.steps[0]).toMatchObject({ inputTokens: 1000, outputTokens: 100, costMicros: 150 });
    expect(trace.steps[1]).toMatchObject({ costMicros: 21 });
    expect(trace.steps[1].detail).toMatch(/^despesa 98% · score/);
    expect(trace.steps[2]).toMatchObject({ costMicros: 300, detail: 'lancamentos' });
    expect(trace.costMicros).toBe(150 + 21 + 300);

    const state = (await api.get('/assistant')).json() as AssistantStateResponse;
    expect(state.devMode).toBe(true);
    expect(state.messages.at(-1)!.trace).toEqual(trace);
    // Os passos ficam gravados em toda resposta; só a entrega depende de quem pede.
    expect(state.messages[1].trace).not.toBeNull();
  });
  describe('mudanças', () => {
    /** O que o Haiku "propôs": o resto dos campos vai null. */
    const proposal = (fields: Record<string, unknown>) => ({
      ocorrencia: null,
      acao: 'editar',
      descricao: null,
      valor_centavos: null,
      data: null,
      hora_inicio: null,
      hora_fim: null,
      categoria: null,
      conta: null,
      local: null,
      sem_prazo: false,
      ...fields,
    });

    const changeRequest = (text: string, proposals: Record<string, unknown>[]) => {
      vi.mocked(extractItems).mockResolvedValue({
        items: [item({ intent: 'change', excerpt: text, amountCents: null })],
        inputTokens: 900,
        outputTokens: 80,
      });
      vi.mocked(planChanges).mockImplementation(async (_text, ctx) => {
        const drafts = [];
        for (const p of proposals) {
          const draft = await buildChange(ctx, p);
          if (draft) drafts.push(draft);
        }
        return {
          text: drafts.length ? '' : 'Não achei esse lançamento.',
          inputTokens: 2000,
          outputTokens: 100,
          tools: ['lancamentos', 'propor_mudanca'],
          drafts,
        };
      });
      return send(text);
    };

    it('muda o valor do lançamento só com a confirmação e desfaz', async () => {
      const [uber] = (
        await api.post('/transactions', {
          kind: 'EXPENSE',
          amountCents: 3000,
          date: '2026-10-19',
          accountId: nubank.id,
          description: 'Uber',
        })
      ).json() as TransactionResponse[];

      const reply = await changeRequest('o uber de ontem foi 35', [
        proposal({ alvo: 'lancamento', id: uber.id, valor_centavos: 3500 }),
      ]);
      expect(reply.messages[1].text).toBe('Confira a mudança e confirme.');
      const [card] = reply.messages[1].cards;
      expect(card.status).toBe('DRAFT');
      expect(card.draft).toMatchObject({
        type: 'change',
        target: 'transaction',
        action: 'update',
        title: 'Uber',
        diffs: [{ field: 'amount', before: 3000, after: 3500 }],
      });
      // Nada muda antes de confirmar.
      expect(
        (await prisma.transaction.findUniqueOrThrow({ where: { id: uber.id } })).amountCents
      ).toBe(3000);

      const saved = (
        await api.post(`/assistant/cards/${card.id}/save`, {})
      ).json() as AssistantCardResponse;
      expect(saved.status).toBe('SAVED');
      expect(
        (await prisma.transaction.findUniqueOrThrow({ where: { id: uber.id } })).amountCents
      ).toBe(3500);

      const undone = (
        await api.post(`/assistant/cards/${card.id}/undo`)
      ).json() as AssistantCardResponse;
      expect(undone.status).toBe('UNDONE');
      expect(
        (await prisma.transaction.findUniqueOrThrow({ where: { id: uber.id } })).amountCents
      ).toBe(3000);
    });

    it('apaga o lançamento e não deixa desfazer', async () => {
      const [uber] = (
        await api.post('/transactions', {
          kind: 'EXPENSE',
          amountCents: 3000,
          date: '2026-10-19',
          accountId: nubank.id,
          description: 'Uber',
        })
      ).json() as TransactionResponse[];
      const [card] = (
        await changeRequest('apaga o último lançamento', [
          proposal({ alvo: 'lancamento', id: uber.id, acao: 'apagar' }),
        ])
      ).messages[1].cards;
      expect(card.draft).toMatchObject({ action: 'delete', diffs: [], revert: null });

      await api.post(`/assistant/cards/${card.id}/save`, {});
      expect(await prisma.transaction.count()).toBe(0);
      expect((await api.post(`/assistant/cards/${card.id}/undo`)).statusCode).toBe(409);
    });

    it('não mexe no que é de outro usuário e repassa o que o Haiku disse', async () => {
      const other = await prisma.user.create({
        data: { email: 'outra@example.com', name: 'Outra', timezone: 'America/Sao_Paulo' },
      });
      const account = await prisma.account.create({
        data: { userId: other.id, name: 'Dela', type: 'CHECKING' },
      });
      const theirs = await prisma.transaction.create({
        data: {
          userId: other.id,
          accountId: account.id,
          kind: 'EXPENSE',
          amountCents: 1000,
          description: 'Dela',
          date: new Date('2026-10-19T00:00:00Z'),
          status: 'DONE',
        },
      });
      const reply = await changeRequest('apaga o lançamento', [
        proposal({ alvo: 'lancamento', id: theirs.id, acao: 'apagar' }),
      ]);
      expect(reply.messages[1].cards).toHaveLength(0);
      expect(reply.messages[1].text).toBe('Não achei esse lançamento.');
      expect(await prisma.transaction.count({ where: { userId: other.id } })).toBe(1);
    });

    it('muda o horário do evento mantendo a duração', async () => {
      const event = (
        await api.post('/events', {
          title: 'Dentista',
          startAt: '2026-10-23T18:00:00.000Z',
          endAt: '2026-10-23T19:00:00.000Z',
          reminders: [],
        })
      ).json();
      const [card] = (
        await changeRequest('muda o dentista para as 16h', [
          proposal({ alvo: 'evento', id: event.id, hora_inicio: '16:00' }),
        ])
      ).messages[1].cards;
      expect(card.draft).toMatchObject({
        target: 'event',
        date: '2026-10-23',
        diffs: [
          { field: 'start', before: '15:00', after: '16:00' },
          { field: 'end', before: '16:00', after: '17:00' },
        ],
      });

      await api.post(`/assistant/cards/${card.id}/save`, {});
      expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({
        startAt: new Date('2026-10-23T19:00:00.000Z'),
        endAt: new Date('2026-10-23T20:00:00.000Z'),
      });
      await api.post(`/assistant/cards/${card.id}/undo`);
      expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).startAt).toEqual(
        new Date('2026-10-23T18:00:00.000Z')
      );
    });

    it('em evento que se repete, mexe só na ocorrência', async () => {
      // Toda segunda às 9h de São Paulo.
      const event = (
        await api.post('/events', {
          title: 'Academia',
          startAt: '2026-10-19T12:00:00.000Z',
          endAt: '2026-10-19T13:00:00.000Z',
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          reminders: [],
        })
      ).json();
      const [card] = (
        await changeRequest('a academia de segunda que vem é às 19h', [
          proposal({
            alvo: 'evento',
            id: event.id,
            ocorrencia: '2026-10-26T12:00:00.000Z',
            hora_inicio: '19:00',
          }),
        ])
      ).messages[1].cards;
      expect(card.draft).toMatchObject({ date: '2026-10-26' });
      await api.post(`/assistant/cards/${card.id}/save`, {});

      const list = (
        await api.get('/events?from=2026-10-18T00:00:00Z&to=2026-11-03T00:00:00Z')
      ).json() as { startAt: string }[];
      expect(list.map((o) => o.startAt)).toEqual([
        '2026-10-19T12:00:00.000Z',
        '2026-10-26T22:00:00.000Z',
        '2026-11-02T12:00:00.000Z',
      ]);
    });

    it('conclui a tarefa e desfaz', async () => {
      const task = (await api.post('/tasks', { title: 'Pagar o IPVA' })).json();
      const [card] = (
        await changeRequest('marca a tarefa do IPVA como feita', [
          proposal({ alvo: 'tarefa', id: task.id, acao: 'concluir' }),
        ])
      ).messages[1].cards;
      expect(card.draft).toMatchObject({ action: 'complete', title: 'Pagar o IPVA' });

      await api.post(`/assistant/cards/${card.id}/save`, {});
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).completedAt
      ).not.toBeNull();
      await api.post(`/assistant/cards/${card.id}/undo`);
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).completedAt
      ).toBeNull();
    });
  });
  describe('beta', () => {
    const owner = () => vi.stubEnv('OWNER_EMAIL', 'andre@example.com');

    /** Um convidado com senha, logado. */
    async function guest() {
      const user = await prisma.user.create({
        data: {
          email: 'bia@example.com',
          name: 'Bia',
          timezone: 'America/Sao_Paulo',
          passwordHash: await hashPassword('senha-da-bia'),
        },
      });
      const login = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { email: 'bia@example.com', password: 'senha-da-bia' },
      });
      const cookie = login.cookies.find((c) => c.name === 'jottape_session')!;
      return { user, api: client(app, `jottape_session=${cookie.value}`) };
    }

    it('o dono convida pelo painel e muda o limite', async () => {
      owner();
      vi.stubEnv('ASSISTANT_EMAILS', '');
      const bia = await guest();
      expect(((await bia.api.get('/assistant')).json() as AssistantStateResponse).enabled).toBe(
        false
      );
      // Só o dono vê o painel.
      expect((await bia.api.get('/assistant/admin')).statusCode).toBe(403);

      const panel = (
        await api.patch(`/assistant/admin/users/${bia.user.id}`, { access: true, limit: 1 })
      ).json() as AssistantAdminResponse;
      expect(panel.users.map((u) => [u.name, u.access, u.limit])).toEqual([
        ['André', 'owner', null],
        ['Bia', 'app', 1],
      ]);

      const state = (await bia.api.get('/assistant')).json() as AssistantStateResponse;
      expect(state).toMatchObject({ enabled: true, admin: false, usage: { used: 0, limit: 1 } });
      vi.mocked(extractItems).mockResolvedValue({ items: [], inputTokens: 1, outputTokens: 1 });
      expect((await bia.api.post('/assistant/messages', { text: 'oi' })).statusCode).toBe(200);
      expect((await bia.api.post('/assistant/messages', { text: 'oi' })).statusCode).toBe(429);

      await api.patch(`/assistant/admin/users/${bia.user.id}`, { access: false });
      expect((await bia.api.post('/assistant/messages', { text: 'oi' })).statusCode).toBe(503);
    });

    it('"Isso está errado" guarda o pedido e aparece no painel com os números', async () => {
      owner();
      vi.stubEnv('JEV_API_KEY', 'jev-test');
      vi.mocked(extractItems).mockResolvedValue({
        items: [item()],
        inputTokens: 900,
        outputTokens: 80,
      });
      vi.mocked(askJev).mockRejectedValue(new Error('timeout'));
      const reply = await send('gastei 32 no mercado no nubank');
      const answer = reply.messages[1];
      expect(answer.reported).toBe(false);
      await api.post(`/assistant/cards/${answer.cards[0].id}/save`, {
        draft: { amountCents: 3500 },
      });

      const report = await api.post(`/assistant/messages/${answer.id}/feedback`, {
        note: 'era 35',
      });
      expect(report.statusCode).toBe(204);
      // Uma vez por resposta.
      await api.post(`/assistant/messages/${answer.id}/feedback`, {});
      expect(await prisma.assistantFeedback.count()).toBe(1);
      const state = (await api.get('/assistant')).json() as AssistantStateResponse;
      expect(state.messages[1].reported).toBe(true);

      // O valor trocado no cartão conta como correção; a falha do Jev vem com o erro.
      const [before] = ((await api.get('/assistant/admin')).json() as AssistantAdminResponse).users;
      expect(before.corrections).toEqual({ amount: 1 });
      expect(before.failures).toEqual([
        { engine: 'jev', error: 'timeout', at: expect.any(String) },
      ]);

      // A conversa some, o relato fica.
      await api.delete('/assistant/messages');
      const panel = (await api.get('/assistant/admin')).json() as AssistantAdminResponse;
      expect(panel.feedback).toHaveLength(1);
      expect(panel.feedback[0]).toMatchObject({
        userName: 'André',
        request: 'gastei 32 no mercado no nubank',
        note: 'era 35',
        resolvedAt: null,
        // O cartão como ficou: com o valor que o usuário trocou.
        cards: [{ type: 'transaction', amountCents: 3500 }],
      });
      expect(panel.feedback[0].trace?.steps.map((s) => [s.engine, s.status])).toEqual([
        ['haiku', 'ok'],
        ['jev', 'failed'],
      ]);
      expect(panel.users[0].month).toMatchObject({ requests: 1 });
      // O caso sugerido sai do cartão, por nome, no dia do pedido.
      const suggested = panel.feedback[0].suggestedCase;
      expect(suggested).toMatchObject({
        text: 'gastei 32 no mercado no nubank',
        timezone: 'America/Sao_Paulo',
        expect: {
          intents: ['expense'],
          amountCents: 3500,
          account: 'Nubank',
          category: 'Mercado',
        },
      });
      expect(suggested.context.accounts.map((a) => a.name)).toContain('Nubank');
      expect(panel.feedback[0].testCaseId).toBeNull();

      const resolved = (
        await api.post(`/assistant/admin/feedback/${panel.feedback[0].id}/resolve`, {
          resolved: true,
        })
      ).json() as AssistantAdminResponse;
      expect(resolved.feedback[0].resolvedAt).not.toBeNull();
    });

    it('relato vira caso de teste, que roda junto no teste de acerto', async () => {
      owner();
      vi.mocked(extractItems).mockResolvedValue({
        items: [
          item({
            intent: 'event',
            amountCents: null,
            description: 'Entrega de trabalho',
            date: '2026-10-21',
            time: '14:00',
            account: null,
            category: null,
          }),
        ],
        inputTokens: 1,
        outputTokens: 1,
      });
      vi.mocked(askJev).mockResolvedValue(null);
      const text = 'entrega de trabalho amanhã às 14h, nas notas: pela plataforma';
      const answer = (await send(text)).messages[1];
      await api.post(`/assistant/messages/${answer.id}/feedback`, { note: 'faltou a nota' });
      const [report] = ((await api.get('/assistant/admin')).json() as AssistantAdminResponse)
        .feedback;
      expect(report.suggestedCase.expect).toEqual({
        intents: ['event'],
        date: '2026-10-21',
        allDay: false,
        time: '14:00',
        endTime: '15:00',
        notes: false,
      });

      // O dono corrige o que estava errado (a nota) e salva.
      const created = (
        await api.post('/assistant/admin/cases', {
          ...report.suggestedCase,
          feedbackId: report.id,
          expect: { ...report.suggestedCase.expect, notes: true },
        })
      ).json() as AssistantAdminResponse;
      expect(created.testCases).toHaveLength(1);
      expect(created.testCases[0]).toMatchObject({ text, active: true, feedbackId: report.id });
      expect(created.feedback[0]).toMatchObject({ testCaseId: created.testCases[0].id });
      expect(created.feedback[0].resolvedAt).not.toBeNull();

      // Roda com o dia e os nomes do relato; sem a nota, falha.
      const result = (
        await api.post('/assistant/admin/benchmark')
      ).json() as AssistantBenchmarkResponse;
      expect(result.total).toBe(51);
      expect(result.cases[50]).toMatchObject({
        text,
        source: 'real',
        caseId: created.testCases[0].id,
        passed: false,
        problems: ['notes'],
      });

      // Desligado, não roda; apagado, some.
      await api.patch(`/assistant/admin/cases/${created.testCases[0].id}`, { active: false });
      expect(
        ((await api.post('/assistant/admin/benchmark')).json() as AssistantBenchmarkResponse).total
      ).toBe(50);
      const deleted = (
        await api.delete(`/assistant/admin/cases/${created.testCases[0].id}`)
      ).json() as AssistantAdminResponse;
      expect(deleted.testCases).toHaveLength(0);

      const exported = await api.get('/assistant/admin/export');
      expect(exported.headers['content-disposition']).toMatch(/jotta-relatos-\d{4}-\d{2}\.json/);
      expect(exported.json()).toMatchObject({ feedback: [{ request: text }] });
    });

    it('conta salvos sozinhos, editados, desfeitos e falhas', async () => {
      owner();
      const mercado = await prisma.category.findFirstOrThrow({ where: { name: 'Mercado' } });
      const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
      const accounts = await prisma.account.findMany({
        orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
      });
      vi.mocked(extractItems).mockResolvedValue({
        items: [item()],
        inputTokens: 1,
        outputTokens: 1,
      });
      vi.mocked(askJev).mockResolvedValue({
        answers: {
          kind: sure('expense'),
          account: sure(`opcao_${accounts.findIndex((a) => a.id === nubank.id) + 1}`),
          category: sure(`opcao_${categories.findIndex((c) => c.id === mercado.id) + 1}`),
        },
        inputTokens: 1,
      });
      const [auto] = (await send('gastei 32 no mercado')).messages[1].cards;
      await api.post(`/assistant/cards/${auto.id}/undo`);

      vi.mocked(askJev).mockResolvedValue(null);
      const [draft] = (await send('gastei 32 no mercado')).messages[1].cards;
      await api.post(`/assistant/cards/${draft.id}/save`, {});

      vi.mocked(extractItems).mockRejectedValue(new Error('overloaded'));
      await send('gastei 32');

      const [me] = ((await api.get('/assistant/admin')).json() as AssistantAdminResponse).users;
      expect(me.recent).toMatchObject({
        cards: 2,
        autoSaved: 1,
        saved: 1,
        edited: 0,
        undone: 1,
        haikuFailed: 1,
        jevFailed: 0,
      });
      expect(me.failures).toEqual([
        { engine: 'haiku', error: 'overloaded', at: expect.any(String) },
      ]);
    });

    it('roda o teste de acerto e registra o custo fora do limite', async () => {
      owner();
      vi.mocked(extractItems).mockImplementation(async (text) => ({
        items: text === 'gastei 32 reais no mercado' ? [item({ category: 'Mercado' })] : [],
        inputTokens: 100,
        outputTokens: 10,
      }));
      vi.mocked(askJev).mockResolvedValue(null);
      const result = (
        await api.post('/assistant/admin/benchmark')
      ).json() as AssistantBenchmarkResponse;
      expect(result.total).toBe(50);
      expect(result.cases[0]).toMatchObject({
        text: 'gastei 32 reais no mercado',
        passed: true,
      });
      expect(result.cases[1].problems).toContain('intents');
      expect(result.costMicros).toBe(Math.round(50 * (100 * 0.1 + 10 * 0.5)));
      expect(await prisma.assistantUsage.count({ where: { kind: 'BENCHMARK' } })).toBe(1);
      expect(((await api.get('/assistant')).json() as AssistantStateResponse).usage.used).toBe(0);
    });
  });
});
