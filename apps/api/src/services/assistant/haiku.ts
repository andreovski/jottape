import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { getAnthropicConfig } from '@/lib/env';

import type { AccountOption, CategoryOption, ExtractedItem } from './resolve';

// Claude Haiku lê o pedido em texto livre e devolve os itens em JSON (saída estruturada). Ele
// extrai valores, datas e nomes, que o Jev não faz bem; a escolha final é conferida pelo Jev.

const MAX_TOKENS = 1024;

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'intent',
    'excerpt',
    'amount_cents',
    'description',
    'date',
    'account',
    'to_account',
    'category',
    'installments',
    'confidence',
  ],
  properties: {
    intent: {
      type: 'string',
      enum: ['expense', 'income', 'transfer', 'event', 'task', 'question', 'other'],
    },
    excerpt: { type: 'string' },
    amount_cents: { type: ['integer', 'null'] },
    description: { type: 'string' },
    date: { type: ['string', 'null'] },
    account: { type: ['string', 'null'] },
    to_account: { type: ['string', 'null'] },
    category: { type: ['string', 'null'] },
    installments: { type: ['integer', 'null'] },
    confidence: { type: 'number' },
  },
} as const;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: ITEM_SCHEMA } },
} as const;

// A resposta é conferida aqui também: a saída estruturada garante o formato, não os limites.
const outputSchema = z.object({
  items: z
    .array(
      z.object({
        intent: z.enum(['expense', 'income', 'transfer', 'event', 'task', 'question', 'other']),
        excerpt: z.string(),
        amount_cents: z.number().int().nullable(),
        description: z.string(),
        date: z.string().nullable(),
        account: z.string().nullable(),
        to_account: z.string().nullable(),
        category: z.string().nullable(),
        installments: z.number().int().nullable(),
        confidence: z.number(),
      })
    )
    .max(10),
});

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export interface ExtractContext {
  today: string;
  timezone: string;
  accounts: AccountOption[];
  categories: CategoryOption[];
}

export function systemPrompt({ today, timezone, accounts, categories }: ExtractContext): string {
  const weekday = WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()];
  const accountList = accounts.map((a) => `- ${a.name} (${a.type})`).join('\n') || '- (nenhuma)';
  const expense = categories.filter((c) => c.kind === 'EXPENSE').map((c) => c.name);
  const income = categories.filter((c) => c.kind === 'INCOME').map((c) => c.name);
  return `Você lê pedidos de um app de finanças pessoais brasileiro (Jottape) e devolve cada pedido como um item estruturado. Não converse: só extraia.

Hoje é ${weekday}, ${today} (fuso ${timezone}).

Contas e cartões do usuário:
${accountList}

Categorias de despesa: ${expense.join(', ') || '(nenhuma)'}
Categorias de receita: ${income.join(', ') || '(nenhuma)'}

Regras:
- Um item por lançamento citado ("30 no uber e 50 no mercado" são dois). Texto sem lançamento vira um item só com o intent certo.
- intent: expense (gasto, compra, conta paga), income (dinheiro recebido), transfer (entre contas do próprio usuário, guardar na poupança, pagar a fatura do cartão), event (compromisso para a agenda), task (algo a fazer), question (pergunta sobre saldo, gastos etc.), other (o resto).
- excerpt: o trecho do pedido que fala deste item, como o usuário escreveu.
- amount_cents: valor em centavos inteiros ("R$ 32,50" = 3250, "mil e duzentos" = 120000, "50 conto" = 5000). Sem valor: null. Em compra parcelada, o valor TOTAL (12x de 100 = 120000).
- installments: número de parcelas quando o pedido disser ("em 3x"), senão null.
- description: curta, do jeito que apareceria no extrato ("Uber", "Mercado", "Salário"), sem o valor.
- date: AAAA-MM-DD. "ontem", "sexta passada", "dia 5" são relativos a hoje. Sem data: null.
- account e to_account: o nome EXATO de uma conta da lista quando o pedido apontar para ela ("no nubank", "no crédito", "no cartão"), senão null. Não invente.
- category: o nome EXATO de uma categoria da lista do tipo certo que combine com o gasto (uber = Transporte, ifood = Alimentação), ou null se nenhuma servir.
- confidence: de 0 a 1, o quanto você tem certeza do item inteiro. Use menos de 0.7 quando houver dúvida real sobre tipo, valor ou conta.`;
}

export interface ExtractResult {
  items: ExtractedItem[];
  inputTokens: number;
  outputTokens: number;
}

let client: Anthropic | null = null;
function anthropic(apiKey: string) {
  client ??= new Anthropic({ apiKey, maxRetries: 2, timeout: 20_000 });
  return client;
}

/** Lê o pedido. Lança erro se o modelo não responder ou responder fora do formato. */
export async function extractItems(text: string, context: ExtractContext): Promise<ExtractResult> {
  const config = getAnthropicConfig();
  if (!config) throw new Error('ANTHROPIC_API_KEY não configurada');

  const message = await anthropic(config.apiKey).messages.create({
    model: config.model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt(context),
    messages: [{ role: 'user', content: text }],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  });

  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
  if (message.stop_reason === 'refusal') return { items: [], ...usage };

  const raw = message.content.find((block) => block.type === 'text')?.text ?? '';
  const parsed = outputSchema.parse(JSON.parse(raw));
  return {
    items: parsed.items.map((item) => ({
      intent: item.intent,
      excerpt: item.excerpt.trim() || text,
      amountCents: item.amount_cents,
      description: item.description,
      date: item.date,
      account: item.account,
      toAccount: item.to_account,
      category: item.category,
      installments: item.installments,
      confidence: item.confidence,
    })),
    ...usage,
  };
}
