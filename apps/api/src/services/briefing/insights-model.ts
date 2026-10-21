import { z } from 'zod';

import { getAnthropicConfig } from '@/lib/env';
import { anthropic, WEEKDAYS } from '@/services/assistant/haiku';

// Insights de IA do briefing: uma chamada ao Haiku, sem ferramentas, com os números do mês já
// lidos pela API. Dinheiro volta como [[centavos]], como nas respostas do Assistente.

const MAX_TOKENS = 4000;
export const MAX_INSIGHTS = 3;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['insights'],
  properties: {
    insights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['texto', 'tom', 'pergunta'],
        properties: {
          texto: { type: 'string' },
          tom: { type: 'string', enum: ['bom', 'neutro', 'atencao', 'ruim'] },
          pergunta: { type: 'string' },
        },
      },
    },
  },
} as const;

const outputSchema = z.object({
  insights: z.array(
    z.object({
      texto: z.string(),
      tom: z.enum(['bom', 'neutro', 'atencao', 'ruim']),
      pergunta: z.string(),
    })
  ),
});

export type ModelInsight = z.infer<typeof outputSchema>['insights'][number];

export interface InsightPromptContext {
  today: string;
  timezone: string;
  kind: 'month' | 'close';
}

export function insightsPrompt({ today, timezone, kind }: InsightPromptContext): string {
  const weekday = WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()];
  const focus =
    kind === 'close'
      ? 'O mês anterior acabou: os dados trazem o mês fechado e o mês antes dele, inteiros. Faça o balanço do mês fechado (chame-o pelo nome, como "Em setembro").'
      : 'Os dados trazem o mês corrente até hoje, o mês passado até o mesmo dia, o mês passado inteiro, os orçamentos do mês e a previsão de saldo até o fim do mês.';
  return `Você escreve os insights de finanças do briefing diário do Jottape, um app brasileiro de finanças pessoais. Leia os números do usuário e escreva de 1 a ${MAX_INSIGHTS} observações curtas e úteis, das mais importantes para as menos.

Hoje é ${weekday}, ${today} (fuso ${timezone}).
${focus}

O que vale a pena dizer (escolha o que os dados mostram com clareza):
- Categorias que subiram ou caíram bastante em relação ao mês anterior, e o que puxou (uma compra grande, várias pequenas).
- Gastos fora do comum: um item bem maior que os outros, uma categoria nova.
- Receitas contra despesas: se está sobrando ou faltando dinheiro no mês.
- Para onde o mês caminha no ritmo atual, e orçamentos que devem estourar.
- Uma boa notícia quando houver (gastou menos, guardou mais).

Regras:
- Nunca invente números: todo valor vem dos dados, ou de uma conta simples com eles (diferença, soma, porcentagem).
- O briefing já mostra o total gasto no mês comparado ao mês passado: não repita só isso. Vá além dele.
- Escreva todo valor em dinheiro como [[centavos]], com o número inteiro (R$ 32,50 vira [[3250]]). Nunca escreva "R$" nem o valor por extenso. Porcentagens podem ir como "38%".
- texto: uma frase em português do Brasil, direta, com até 150 caracteres, sem markdown e sem emoji. Não diga "hoje", "ontem" nem quantos dias faltam: o texto pode ser lido nos dias seguintes.
- Datas como "12 de outubro", nunca AAAA-MM-DD. Use os nomes das categorias e das descrições como vieram.
- tom: "bom" (notícia boa), "neutro", "atencao" (vale ficar de olho) ou "ruim" (problema claro, como faltar dinheiro).
- pergunta: o que o usuário perguntaria ao Assistente para entender melhor esse ponto, em primeira pessoa e com até 80 caracteres ("Com o que gastei mais em Mercado este mês?").
- Com poucos dados para comparar, escreva menos insights (ou nenhum, com a lista vazia) em vez de forçar.`;
}

export interface InsightsResult {
  insights: ModelInsight[];
  inputTokens: number;
  outputTokens: number;
}

/** Lança erro se o modelo não responder ou responder fora do formato. */
export async function writeInsights(
  data: unknown,
  context: InsightPromptContext
): Promise<InsightsResult> {
  const config = getAnthropicConfig();
  if (!config) throw new Error('ANTHROPIC_API_KEY não configurada');

  const message = await anthropic(config.apiKey).messages.create({
    model: config.model,
    max_tokens: MAX_TOKENS,
    system: insightsPrompt(context),
    messages: [{ role: 'user', content: JSON.stringify(data) }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  });

  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
  if (message.stop_reason === 'refusal') return { insights: [], ...usage };

  const raw = message.content.find((block) => block.type === 'text')?.text ?? '';
  const parsed = outputSchema.parse(JSON.parse(raw));
  return { insights: parsed.insights.slice(0, MAX_INSIGHTS), ...usage };
}
