import type {
  AccountResponse,
  AssistantCardResponse,
  AssistantReplyResponse,
  AssistantStateResponse,
  TransactionResponse,
} from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { answerQuestion } from '@/services/assistant/answer';
import { extractItems } from '@/services/assistant/haiku';
import { askJev } from '@/services/assistant/jev';
import { QUERY_HANDLERS } from '@/services/assistant/queries';
import type { ExtractedItem } from '@/services/assistant/resolve';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

// O Haiku e o Jev são de fora: o teste decide o que eles "responderam".
vi.mock('@/services/assistant/haiku', () => ({ extractItems: vi.fn() }));
vi.mock('@/services/assistant/jev', () => ({ askJev: vi.fn() }));
vi.mock('@/services/assistant/answer', () => ({ answerQuestion: vi.fn() }));

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
    await resetDatabase();
    const login = await loginAsOwner(app);
    cookieHeader = login.cookie;
    api = client(app, login.cookie);
    nubank = (await api.post('/accounts', { name: 'Nubank', type: 'CHECKING' })).json();
    wallet = (await api.post('/accounts', { name: 'Carteira', type: 'WALLET' })).json();
  });

  const send = async (text: string) => {
    const response = await api.post('/assistant/messages', { text });
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

    const reply = await send('gastei 32 no mercado no nubank');
    expect(reply.messages.map((m) => m.role)).toEqual(['USER', 'ASSISTANT']);
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
});
