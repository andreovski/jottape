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
import { extractItems } from '@/services/assistant/haiku';
import { askJev } from '@/services/assistant/jev';
import type { ExtractedItem } from '@/services/assistant/resolve';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

// O Haiku e o Jev são de fora: o teste decide o que eles "responderam".
vi.mock('@/services/assistant/haiku', () => ({ extractItems: vi.fn() }));
vi.mock('@/services/assistant/jev', () => ({ askJev: vi.fn() }));

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
    vi.mocked(extractItems).mockReset();
    vi.mocked(askJev).mockReset();
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
        item({ intent: 'event', excerpt: 'dentista amanhã', amountCents: null }),
      ],
      inputTokens: 900,
      outputTokens: 120,
    });
    vi.mocked(askJev).mockResolvedValue(null);

    const reply = await send('gastei 32 no mercado no nubank e marca dentista amanhã');
    const cards = reply.messages[1].cards;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ status: 'DRAFT', score: 0.8, missing: [] });
    expect(reply.messages[1].text).toMatch(/^Confira e salve\. Agenda, tarefas/);

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

  it('transcreve o áudio pela OpenAI e registra os segundos', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai');
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
      expect(usage).toMatchObject({ kind: 'TRANSCRIPTION', audioSeconds: 6, costMicros: 300 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
