import type {
  AccountResponse,
  BriefingInsightsStatus,
  BriefingResponse,
  BriefingSettings,
} from '@jottape/schemas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '@/app';
import { prisma } from '@/lib/prisma';
import { ensureInsights, runInsights } from '@/services/briefing/insights';
import { writeInsights } from '@/services/briefing/insights-model';
import { client, loginAsOwner, resetDatabase } from '@/test/helpers';

// O Haiku é de fora: o teste decide o que ele "escreveu".
vi.mock('@/services/briefing/insights-model', () => ({ writeInsights: vi.fn() }));

// Terça, 20/10/2026, 10:00 em São Paulo.
const NOW = new Date('2026-10-20T13:00:00Z');

const answer = {
  insights: [
    {
      texto: 'Mercado subiu 50% em relação a setembro: [[30000]] contra [[20000]].',
      tom: 'atencao' as const,
      pergunta: 'Com o que gastei mais em Mercado este mês?',
    },
  ],
  inputTokens: 6000,
  outputTokens: 800,
};

describe('insights de IA do briefing', () => {
  let api: ReturnType<typeof client>;
  let userId: string;
  let account: AccountResponse;

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
    vi.mocked(writeInsights).mockReset();
    vi.mocked(writeInsights).mockResolvedValue(answer);
    await resetDatabase();
    const login = await loginAsOwner(app);
    userId = login.user.id;
    api = client(app, login.cookie);
    account = (await api.post('/accounts', { name: 'Nubank', type: 'CHECKING' })).json();
    const settings = (await api.get('/briefing/settings')).json() as BriefingSettings;
    await api.put('/briefing/settings', {
      ...settings,
      plugins: [{ id: 'insights', enabled: true }],
    });
  });

  const spend = async (date: string, amountCents: number, description = 'Mercado') =>
    api.post('/transactions', {
      kind: 'EXPENSE',
      amountCents,
      date,
      accountId: account.id,
      description,
    });

  async function someMonths() {
    for (const date of ['2026-09-03', '2026-09-10', '2026-09-15']) await spend(date, 100_00);
    for (const date of ['2026-10-02', '2026-10-08', '2026-10-12']) await spend(date, 100_00);
  }

  const insightItems = async () =>
    ((await api.get('/briefing')).json() as BriefingResponse).items.filter(
      (i) => i.plugin === 'insights'
    );

  it('na primeira abertura prepara em segundo plano e depois mostra a análise', async () => {
    await someMonths();
    const first = await insightItems();
    expect(first[0].text).toContain('Preparando');

    await ensureInsights(userId, { now: NOW });
    const [item] = await insightItems();
    expect(item).toMatchObject({
      text: 'Mercado subiu 50% em relação a setembro: {0} contra {1}.',
      values: [30000, 20000],
      tone: 'warning',
      href: `/assistente?pergunta=${encodeURIComponent('Com o que gastei mais em Mercado este mês?')}`,
    });

    expect(writeInsights).toHaveBeenCalledTimes(1);
    const [data, context] = vi.mocked(writeInsights).mock.calls[0];
    expect(context).toMatchObject({ today: '2026-10-20', kind: 'month' });
    expect(data).toMatchObject({
      mes_atual_ate_hoje: { mes: '2026-10', despesas_realizadas_centavos: 300_00 },
      mes_passado_ate_o_mesmo_dia: { mes: '2026-09', despesas_realizadas_centavos: 300_00 },
    });

    const usage = await prisma.assistantUsage.findFirstOrThrow();
    expect(usage).toMatchObject({ kind: 'INSIGHT', modelInputTokens: 6000, costMicros: 1000 });
  });

  it('gera no máximo uma vez por dia e reaproveita sem lançamento novo', async () => {
    await someMonths();
    await ensureInsights(userId, { now: NOW });
    await ensureInsights(userId, { now: NOW });
    expect(writeInsights).toHaveBeenCalledTimes(1);

    // Dia seguinte, nada mudou: reaproveita.
    const tomorrow = new Date('2026-10-21T13:00:00Z');
    vi.setSystemTime(tomorrow);
    await runInsights(tomorrow);
    expect(writeInsights).toHaveBeenCalledTimes(1);
    const row = await prisma.financeInsight.findUniqueOrThrow({ where: { userId } });
    expect(row.attemptedOn).toBe('2026-10-21');

    // Outro dia com lançamento novo: refaz.
    const later = new Date('2026-10-22T13:00:00Z');
    vi.setSystemTime(later);
    await spend('2026-10-22', 50_00, 'Padaria');
    await runInsights(later);
    expect(writeInsights).toHaveBeenCalledTimes(2);
  });

  it('a rotina espera as 5h e para sem abrir o briefing há 3 dias', async () => {
    await someMonths();
    await prisma.financeInsight.create({ data: { userId, viewedAt: NOW } });

    // 4:30 em São Paulo.
    await runInsights(new Date('2026-10-21T07:30:00Z'));
    expect(writeInsights).not.toHaveBeenCalled();

    await runInsights(new Date('2026-10-24T13:00:00Z'));
    expect(writeInsights).not.toHaveBeenCalled();

    await runInsights(new Date('2026-10-21T08:30:00Z'));
    expect(writeInsights).toHaveBeenCalledTimes(1);
  });

  it('com poucos lançamentos não chama a IA', async () => {
    await spend('2026-10-02', 100_00);
    await ensureInsights(userId, { now: NOW });
    expect(writeInsights).not.toHaveBeenCalled();
    expect(await insightItems()).toEqual([]);
  });

  it('no começo do mês analisa o fechamento do mês anterior', async () => {
    await someMonths();
    const early = new Date('2026-11-02T13:00:00Z');
    vi.setSystemTime(early);
    await ensureInsights(userId, { now: early });
    const [data, context] = vi.mocked(writeInsights).mock.calls[0];
    expect(context.kind).toBe('close');
    expect(data).toMatchObject({
      mes_fechado: { mes: '2026-10', despesas_realizadas_centavos: 300_00 },
      mes_antes: { mes: '2026-09' },
    });
  });

  it('o botão atualiza uma vez por dia', async () => {
    await someMonths();
    await ensureInsights(userId, { now: NOW });

    const refreshed = await api.post('/briefing/insights/refresh');
    expect(refreshed.statusCode).toBe(200);
    const status = refreshed.json() as BriefingInsightsStatus;
    expect(status).toMatchObject({ available: true, kind: 'month', canRefresh: false });
    expect(writeInsights).toHaveBeenCalledTimes(2);

    expect((await api.post('/briefing/insights/refresh')).statusCode).toBe(429);
  });

  it('fica de fora para quem não tem o Assistente', async () => {
    vi.stubEnv('ASSISTANT_EMAILS', '');
    await someMonths();
    expect(await insightItems()).toEqual([]);
    const status = (await api.get('/briefing/insights')).json() as BriefingInsightsStatus;
    expect(status.available).toBe(false);
    expect((await api.post('/briefing/insights/refresh')).statusCode).toBe(503);
  });
});
