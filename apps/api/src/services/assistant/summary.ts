import { normalize } from './resolve';

// Funções puras das consultas do Assistente (com teste).

/** Itens que a consulta de lançamentos devolve ao modelo (o resto só entra nos totais). */
const MAX_ITEMS = 25;

/** Nomes pedidos que casam com as opções (exato, senão "contém"), e os que não casaram. */
export function matchNames<T extends { name: string }>(options: T[], names: string[]) {
  const found = new Set<T>();
  const missing: string[] = [];
  for (const name of names) {
    const wanted = normalize(name);
    const exact = options.filter((o) => normalize(o.name) === wanted);
    const matches = exact.length
      ? exact
      : options.filter((o) => {
          const candidate = normalize(o.name);
          return candidate && (candidate.includes(wanted) || wanted.includes(candidate));
        });
    if (matches.length === 0) missing.push(name);
    matches.forEach((m) => found.add(m));
  }
  return { found: [...found], missing };
}

export interface LedgerRow {
  id: string;
  date: string;
  /** Quando foi lançado (ISO): ordena "o último que lancei". */
  createdAt: string;
  description: string;
  amountCents: number;
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  status: 'DONE' | 'PLANNED';
  category: string | null;
  account: string;
}

/** Totais, por categoria e os itens (os maiores, ou os lançados por último), do que a consulta achou. */
export function summarizeLedger(rows: LedgerRow[], order: 'valor' | 'recentes' = 'valor') {
  const total = (kind: LedgerRow['kind'], status: LedgerRow['status']) =>
    rows
      .filter((r) => r.kind === kind && r.status === status)
      .reduce((s, r) => s + r.amountCents, 0);
  const byCategory = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== 'EXPENSE' || row.status !== 'DONE') continue;
    const key = row.category ?? 'Sem categoria';
    byCategory.set(key, (byCategory.get(key) ?? 0) + row.amountCents);
  }
  return {
    quantidade: rows.length,
    despesas_realizadas_centavos: total('EXPENSE', 'DONE'),
    despesas_previstas_centavos: total('EXPENSE', 'PLANNED'),
    receitas_realizadas_centavos: total('INCOME', 'DONE'),
    receitas_previstas_centavos: total('INCOME', 'PLANNED'),
    despesas_por_categoria: [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([categoria, total_centavos]) => ({ categoria, total_centavos })),
    itens: [...rows]
      .sort((a, b) =>
        order === 'recentes'
          ? b.createdAt.localeCompare(a.createdAt)
          : b.amountCents - a.amountCents
      )
      .slice(0, MAX_ITEMS)
      .map((r) => ({
        id: r.id,
        data: r.date,
        descricao: r.description,
        valor_centavos: r.amountCents,
        tipo: { INCOME: 'receita', EXPENSE: 'despesa', TRANSFER: 'transferencia' }[r.kind],
        situacao: r.status === 'DONE' ? 'realizado' : 'previsto',
        categoria: r.category,
        conta: r.account,
      })),
    itens_omitidos: Math.max(0, rows.length - MAX_ITEMS),
  };
}
