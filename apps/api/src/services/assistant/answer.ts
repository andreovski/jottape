import type Anthropic from '@anthropic-ai/sdk';

import { getAnthropicConfig } from '@/lib/env';

import { anthropic, WEEKDAYS } from './haiku';
import { QUERY_HANDLERS, type QueryContext } from './queries';
import type { AccountOption, CategoryOption, TaskListOption } from './resolve';

// Perguntas ("quanto gastei ontem com comida?", "o que tenho amanhã?"): o Haiku consulta os dados
// do usuário por ferramentas só de leitura e responde. Dinheiro vai como [[centavos]] na resposta,
// para o app poder ocultar.

const MAX_TOKENS = 2000;
/** Rodadas de ferramenta antes de desistir (cada rodada é uma chamada ao modelo). */
const MAX_ROUNDS = 5;

const dateRange = {
  de: { type: 'string', description: 'Primeiro dia, AAAA-MM-DD.' },
  ate: { type: 'string', description: 'Último dia (incluso), AAAA-MM-DD.' },
} as const;

const nullableNames = (description: string) => ({
  type: ['array', 'null'],
  items: { type: 'string' },
  description,
});

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'lancamentos',
    description:
      'Lançamentos (receitas, despesas ou transferências) de um período, com totais realizados e previstos, total de despesas por categoria e os maiores itens. Use para "quanto gastei", "quanto recebi", "com o que gastei", "qual foi a maior compra". Compras no cartão de crédito contam como despesa na data da compra.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['de', 'ate', 'tipo', 'categorias', 'contas', 'busca'],
      properties: {
        ...dateRange,
        tipo: { type: 'string', enum: ['despesa', 'receita', 'transferencia', 'todos'] },
        categorias: nullableNames(
          'Nomes EXATOS de categorias (a categoria-mãe inclui as subcategorias), ou null para todas.'
        ),
        contas: nullableNames('Nomes EXATOS de contas ou cartões, ou null para todas.'),
        busca: {
          type: ['string', 'null'],
          description: 'Trecho da descrição ("uber", "ifood"), ou null.',
        },
      },
    },
  },
  {
    name: 'contas',
    description:
      'Saldo atual de cada conta e o total; nos cartões, a fatura aberta e as faturas não pagas com vencimento.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
  },
  {
    name: 'orcamentos',
    description: 'Orçamentos por categoria de um mês: limite, gasto, previsto e quanto resta.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['mes'],
      properties: { mes: { type: 'string', description: 'AAAA-MM.' } },
    },
  },
  {
    name: 'previsao_saldo',
    description:
      'Saldo total projetado para os próximos dias, com os lançamentos previstos e as faturas: o saldo no fim, o menor saldo e o primeiro dia negativo.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['dias'],
      properties: { dias: { type: 'integer', description: 'De 1 a 365.' } },
    },
  },
  {
    name: 'agenda',
    description: 'Eventos da agenda num período (horários no fuso do usuário).',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['de', 'ate'],
      properties: dateRange,
    },
  },
  {
    name: 'tarefas',
    description: 'Tarefas abertas (ou concluídas), por visão, lista ou busca.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['visao', 'lista', 'busca'],
      properties: {
        visao: {
          type: 'string',
          enum: ['todas', 'hoje', 'proximos_7_dias', 'atrasadas', 'sem_data', 'concluidas'],
          description: '"hoje" inclui as atrasadas; "todas" são as abertas.',
        },
        lista: { type: ['string', 'null'], description: 'Nome EXATO da lista, ou null.' },
        busca: { type: ['string', 'null'] },
      },
    },
  },
];

export interface AnswerContext extends QueryContext {
  accounts: AccountOption[];
  categories: CategoryOption[];
  lists: TaskListOption[];
  /** As últimas mensagens da conversa, para perguntas como "e anteontem?". */
  history: { role: 'USER' | 'ASSISTANT'; text: string }[];
}

export function answerPrompt(ctx: AnswerContext): string {
  const weekday = WEEKDAYS[new Date(`${ctx.today}T12:00:00Z`).getUTCDay()];
  const expense = ctx.categories.filter((c) => c.kind === 'EXPENSE').map((c) => c.name);
  const income = ctx.categories.filter((c) => c.kind === 'INCOME').map((c) => c.name);
  return `Você é o Assistente do Jottape, um app brasileiro de finanças, agenda e tarefas. Responda às perguntas do usuário sobre os dados dele, consultando as ferramentas. Nunca invente números: todo valor da resposta vem de uma ferramenta.

Hoje é ${weekday}, ${ctx.today} (fuso ${ctx.timezone}).

Contas e cartões: ${ctx.accounts.map((a) => a.name).join(', ') || '(nenhuma)'}
Categorias de despesa: ${expense.join(', ') || '(nenhuma)'}
Categorias de receita: ${income.join(', ') || '(nenhuma)'}
Listas de tarefas: ${ctx.lists.map((l) => l.name).join(', ') || '(nenhuma)'}

Regras:
- Datas relativas a hoje: "ontem", "semana passada" (segunda a domingo), "este mês" (do dia 1 a hoje), "mês passado" (o mês inteiro).
- Palavras do usuário viram as categorias certas da lista ("comida" = Alimentação e as parecidas, "carro" = Transporte). Se nenhuma servir, consulte sem categoria e use a busca.
- "Gastei" é despesa realizada. Fale dos previstos só quando a pergunta for sobre o futuro ou quando eles mudarem a resposta.
- Escreva todo valor em dinheiro como [[centavos]], com o número inteiro que veio da ferramenta (R$ 32,50 vira [[3250]]). Nunca escreva "R$" nem o valor por extenso.
- Responda em português do Brasil, curto e direto, em texto simples, sem markdown, sem títulos e sem tabelas. Uma ou duas frases; lista com "- " só quando houver vários itens, até 5.
- Datas na resposta como "ontem", "sexta" ou "12 de outubro", nunca AAAA-MM-DD.
- O pedido pode trazer também lançamentos, eventos ou tarefas para criar: isso é feito por outra parte do app. Responda só às perguntas e não diga que criou nada.
- Se a pergunta não for sobre os dados do app, diga em uma frase que você responde sobre finanças, agenda e tarefas.`;
}

export interface AnswerResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** Responde às perguntas do pedido. Lança erro se o modelo falhar. */
export async function answerQuestion(question: string, ctx: AnswerContext): Promise<AnswerResult> {
  const config = getAnthropicConfig();
  if (!config) throw new Error('ANTHROPIC_API_KEY não configurada');

  const messages: Anthropic.MessageParam[] = [
    ...ctx.history.map(
      (m): Anthropic.MessageParam => ({
        role: m.role === 'USER' ? 'user' : 'assistant',
        content: m.text,
      })
    ),
    { role: 'user', content: question },
  ];
  // A API pede a primeira mensagem do usuário e os papéis alternando.
  while (messages.length > 1 && messages[0].role !== 'user') messages.shift();

  let inputTokens = 0;
  let outputTokens = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await anthropic(config.apiKey).messages.create({
      model: config.model,
      max_tokens: MAX_TOKENS,
      system: answerPrompt(ctx),
      tools: TOOLS,
      output_config: { effort: 'low' },
      messages,
    });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason === 'refusal') break;
    const calls = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );
    if (response.stop_reason !== 'tool_use' || calls.length === 0) {
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      return { text, inputTokens, outputTokens };
    }

    // O conteúdo inteiro volta (com os blocos de raciocínio), e os resultados numa mensagem só.
    messages.push({ role: 'assistant', content: response.content });
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.ToolResultBlockParam> => {
        const handler = QUERY_HANDLERS[call.name];
        if (!handler) {
          return {
            type: 'tool_result',
            tool_use_id: call.id,
            content: 'Ferramenta desconhecida.',
            is_error: true,
          };
        }
        try {
          const result = await handler(ctx, (call.input ?? {}) as Record<string, unknown>);
          return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) };
        } catch {
          return {
            type: 'tool_result',
            tool_use_id: call.id,
            content: 'A consulta falhou.',
            is_error: true,
          };
        }
      })
    );
    messages.push({ role: 'user', content: results });
  }
  return { text: '', inputTokens, outputTokens };
}
