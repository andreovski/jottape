import { z } from 'zod';

import { getAnthropicConfig } from '@/lib/env';
import { anthropic } from '@/services/assistant/haiku';
import { askJevCategory, type JevCategoryResult } from '@/services/assistant/jev';

// As chamadas de IA da categoria na revisão do banco: o Haiku olha um lote de uma vez e o Jev
// confere cada um. Só o que fala com fora; a decisão é `decideAiCategory` (movements.ts).

export interface AiMovement {
  kind: 'INCOME' | 'EXPENSE';
  amountCents: number;
  /** Título curto ("Josiane Cristina"). */
  title: string;
  /** O texto como veio do banco. */
  bankText: string;
  card: boolean;
}

export interface AiCategory {
  id: string;
  /** Como a pessoa vê: "Transferência › Pix". */
  label: string;
  kind: 'INCOME' | 'EXPENSE';
}

const MAX_TOKENS = 4000;
const NONE = 'nenhuma';

const outputSchema = z.object({
  itens: z.array(z.object({ n: z.number().int(), categoria: z.string() })),
});

export function categoryPrompt(categories: AiCategory[]): string {
  const list = (kind: AiCategory['kind']) =>
    categories
      .filter((c) => c.kind === kind)
      .map((c) => `- ${c.label}`)
      .join('\n') || '- (nenhuma)';
  return `Você categoriza lançamentos importados do extrato bancário de um usuário brasileiro, no app de finanças pessoais Jottape. Para cada lançamento, escolha a categoria do usuário que mais faz sentido.

Categorias de saída (dinheiro que saiu):
${list('EXPENSE')}

Categorias de entrada (dinheiro que entrou):
${list('INCOME')}

Regras:
- Use só uma categoria do mesmo tipo do lançamento, escrita exatamente como na lista (com o " › " das subcategorias).
- Prefira a subcategoria quando ela couber; a categoria-mãe só quando nenhuma subcategoria couber.
- Olhe o título (a pessoa ou o estabelecimento) e o texto do banco. Lojas, apps e serviços conhecidos têm categoria óbvia (Uber é transporte, iFood é alimentação, Netflix é assinatura).
- Transferência (Pix, Débito, Crédito) é para quando não dá para saber o que foi comprado: um Pix para uma pessoa, um débito sem loja reconhecível.
- Na dúvida, responda "${NONE}". Errar é pior que deixar em branco: a pessoa confere tudo antes de lançar.
- Responda um item para cada lançamento, com o mesmo n.`;
}

/** O Haiku escolhe a categoria de cada lançamento, pelo nome. Lança erro fora do formato. */
export async function classifyWithHaiku(
  movements: AiMovement[],
  categories: AiCategory[]
): Promise<{ picks: (string | null)[]; inputTokens: number; outputTokens: number }> {
  const config = getAnthropicConfig();
  if (!config) throw new Error('ANTHROPIC_API_KEY não configurada');

  const labels = [...new Set(categories.map((c) => c.label)), NONE];
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['itens'],
    properties: {
      itens: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['n', 'categoria'],
          properties: {
            n: { type: 'integer' },
            categoria: { type: 'string', enum: labels },
          },
        },
      },
    },
  };
  const input = movements.map((m, i) => ({
    n: i + 1,
    tipo: m.kind === 'INCOME' ? 'entrada' : 'saída',
    valor: `R$ ${(m.amountCents / 100).toFixed(2).replace('.', ',')}`,
    onde: m.card ? 'cartão de crédito' : 'conta',
    titulo: m.title,
    texto_do_banco: m.bankText,
  }));

  const message = await anthropic(config.apiKey).messages.create({
    model: config.model,
    max_tokens: MAX_TOKENS,
    system: categoryPrompt(categories),
    messages: [{ role: 'user', content: JSON.stringify(input) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
  });
  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
  if (message.stop_reason === 'refusal') return { picks: movements.map(() => null), ...usage };

  const raw = message.content.find((block) => block.type === 'text')?.text ?? '';
  const parsed = outputSchema.parse(JSON.parse(raw));
  const picks = movements.map((m, i) => {
    const label = parsed.itens.find((item) => item.n === i + 1)?.categoria;
    if (!label || label === NONE) return null;
    // O mesmo nome existe em entradas e saídas (Transferência): vale o do tipo do lançamento.
    return categories.find((c) => c.label === label && c.kind === m.kind)?.id ?? null;
  });
  return { picks, ...usage };
}

/** O Jev dá a probabilidade de cada categoria do mesmo tipo. Sem a chave ou com erro, null. */
export async function scoreWithJev(
  movement: AiMovement,
  categories: AiCategory[]
): Promise<JevCategoryResult | null> {
  const value = `R$ ${(movement.amountCents / 100).toFixed(2).replace('.', ',')}`;
  const text = [
    `${movement.kind === 'INCOME' ? 'Entrada' : 'Saída'} de ${value}`,
    movement.card ? 'no cartão de crédito' : 'na conta',
    `· ${movement.title}`,
    movement.bankText !== movement.title ? `· texto do banco: ${movement.bankText}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return askJevCategory(
    text,
    categories.filter((c) => c.kind === movement.kind)
  );
}
