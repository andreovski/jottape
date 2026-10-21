import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { getAnthropicConfig } from '@/lib/env';

import type { AccountOption, CategoryOption, ExtractedItem, TaskListOption } from './resolve';

// Claude Haiku lê o pedido em texto livre e devolve os itens em JSON (saída estruturada). Ele
// extrai valores, datas e nomes, que o Jev não faz bem; a escolha final é conferida pelo Jev.

const MAX_TOKENS = 1500;

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
    'time',
    'end_time',
    'all_day',
    'list',
    'location',
    'notes',
    'confidence',
  ],
  properties: {
    intent: {
      type: 'string',
      enum: ['expense', 'income', 'transfer', 'event', 'task', 'question', 'change', 'other'],
    },
    excerpt: { type: 'string' },
    amount_cents: { type: ['integer', 'null'] },
    description: { type: 'string' },
    date: { type: ['string', 'null'] },
    account: { type: ['string', 'null'] },
    to_account: { type: ['string', 'null'] },
    category: { type: ['string', 'null'] },
    installments: { type: ['integer', 'null'] },
    time: { type: ['string', 'null'] },
    end_time: { type: ['string', 'null'] },
    all_day: { type: 'boolean' },
    list: { type: ['string', 'null'] },
    location: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
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
        intent: z.enum([
          'expense',
          'income',
          'transfer',
          'event',
          'task',
          'question',
          'change',
          'other',
        ]),
        excerpt: z.string(),
        amount_cents: z.number().int().nullable(),
        description: z.string(),
        date: z.string().nullable(),
        account: z.string().nullable(),
        to_account: z.string().nullable(),
        category: z.string().nullable(),
        installments: z.number().int().nullable(),
        time: z.string().nullable(),
        end_time: z.string().nullable(),
        all_day: z.boolean(),
        list: z.string().nullable(),
        location: z.string().nullable(),
        notes: z.string().nullable(),
        confidence: z.number(),
      })
    )
    .max(10),
});

export const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export interface ExtractContext {
  today: string;
  timezone: string;
  accounts: AccountOption[];
  categories: CategoryOption[];
  lists: TaskListOption[];
  /** O que a pessoa costuma usar (aprendido com as correções dela). */
  preferences?: { label: string; account?: string; category?: string }[];
}

export function systemPrompt({
  today,
  timezone,
  accounts,
  categories,
  lists,
  preferences = [],
}: ExtractContext): string {
  const weekday = WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()];
  const accountList = accounts.map((a) => `- ${a.name} (${a.type})`).join('\n') || '- (nenhuma)';
  const expense = categories.filter((c) => c.kind === 'EXPENSE').map((c) => c.name);
  const income = categories.filter((c) => c.kind === 'INCOME').map((c) => c.name);
  return `Você lê pedidos feitos ao Jottape, um app brasileiro de finanças, agenda e tarefas, e devolve cada pedido como um item estruturado. Não converse: só extraia.

Hoje é ${weekday}, ${today} (fuso ${timezone}).

Contas e cartões do usuário:
${accountList}

Categorias de despesa: ${expense.join(', ') || '(nenhuma)'}
Categorias de receita: ${income.join(', ') || '(nenhuma)'}
Listas de tarefas: ${lists.map((l) => l.name).join(', ') || '(nenhuma)'}
${
  preferences.length
    ? `
Como este usuário costuma lançar (aprendido com as correções dele; vale quando o pedido não disser outra coisa):
${preferences
  .map(
    (p) =>
      `- ${p.label}: ${[p.account && `conta ${p.account}`, p.category && `categoria ${p.category}`].filter(Boolean).join(', ')}`
  )
  .join('\n')}
`
    : ''
}
Regras:
- Um item por coisa pedida ("30 no uber e 50 no mercado" são dois; "marca dentista amanhã e me lembra de comprar pão" também). Texto sem pedido vira um item só com o intent certo.
- intent: expense (gasto, compra, conta paga), income (dinheiro recebido), transfer (entre contas do próprio usuário, guardar na poupança, pagar a fatura do cartão), event (compromisso com dia e hora para a agenda: consulta, reunião, aula, viagem, aniversário), task (algo a fazer ou lembrar, sem ser um compromisso marcado: "me lembra de", "preciso", "anota para"), question (pergunta sobre os dados: saldo, gastos, fatura, orçamento, agenda, tarefas: "quanto gastei ontem?", "o que tenho amanhã?"; vira um item só, mesmo com várias perguntas), change (mudar, apagar ou concluir algo que JÁ existe: "apaga o último lançamento", "o uber de ontem foi 35", "muda o dentista para as 16h", "marca a tarefa do IPVA como feita"; um item por coisa a mudar, com o excerpt do pedido), other (o resto).
- excerpt: o trecho do pedido que fala deste item, como o usuário escreveu.
- amount_cents: valor em centavos inteiros ("R$ 32,50" = 3250, "mil e duzentos" = 120000, "50 conto" = 5000). Sem valor ou fora de finanças: null. Em compra parcelada, o valor TOTAL (12x de 100 = 120000).
- installments: número de parcelas quando o pedido disser ("em 3x"), senão null.
- description: em finanças, curta como no extrato ("Uber", "Mercado", "Salário"), sem o valor. Em evento e tarefa, o título, com a primeira letra maiúscula e sem a data ("Dentista", "Reunião com a Ana", "Pagar o IPVA").
- date: AAAA-MM-DD. "ontem", "amanhã", "sexta", "dia 5", "semana que vem" são relativos a hoje (dia da semana sem "passada" é o próximo). Sem data: null.
- time e end_time: HH:MM em 24 h ("15h" = 15:00, "3 da tarde" = 15:00, "meio-dia" = 12:00), de início e de fim; sem horário: null. Em tarefa, time é o horário do prazo.
- all_day: true só em evento que o pedido diz ser o dia todo, ou que é de dia inteiro por natureza (aniversário, feriado, viagem de vários dias). Senão false.
- location: o local do evento quando o pedido disser, senão null.
- notes: em evento e tarefa, o que o pedido manda anotar ou os detalhes que não cabem no título ("nas notas coloque que...", "levar os exames", "o link é tal"), escrito como uma nota curta e completa, sem "nas notas coloque". Sem nada assim, ou em finanças: null. Detalhe que foi para as notas não é motivo para baixar a confidence.
- list: o nome EXATO de uma lista de tarefas quando o pedido apontar para ela ("na lista do mercado", "no trabalho"), senão null.
- account e to_account: o nome EXATO de uma conta da lista quando o pedido apontar para ela ("no nubank", "no crédito", "no cartão"), senão null. Não invente.
- category: o nome EXATO de uma categoria da lista do tipo certo que combine com o gasto (uber = Transporte, ifood = Alimentação), ou null se nenhuma servir.
- confidence: de 0 a 1, o quanto você tem certeza do item inteiro. Use menos de 0.7 quando houver dúvida real sobre o tipo, o valor, a conta, a data ou o horário.`;
}

export interface ExtractResult {
  items: ExtractedItem[];
  inputTokens: number;
  outputTokens: number;
}

let client: Anthropic | null = null;
export function anthropic(apiKey: string) {
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
      time: item.time,
      endTime: item.end_time,
      allDay: item.all_day,
      list: item.list,
      location: item.location,
      notes: item.notes,
      confidence: item.confidence,
    })),
    ...usage,
  };
}
