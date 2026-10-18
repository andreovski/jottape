/** Um bloco da linha do tempo, em minutos desde a meia-noite do dia. */
export interface TimedItem {
  id: string;
  start: number;
  end: number;
}

export interface PlacedItem extends TimedItem {
  /** Coluna (0 = a mais à esquerda) dentro do grupo de eventos que se sobrepõem. */
  column: number;
  /** Quantas colunas o grupo tem. */
  columns: number;
  /** Quantas colunas o bloco ocupa (cresce para a direita quando ali está livre). */
  span: number;
}

/**
 * Lado a lado, como o Calendário do iPhone: eventos que se sobrepõem (direta ou indiretamente)
 * formam um grupo; cada um entra na primeira coluna livre do grupo, e o grupo divide a largura
 * pelo número de colunas. Um bloco se estica para as colunas da direita que estiverem vazias na
 * altura dele.
 *
 * `minDuration` (minutos) é a altura mínima que o bloco terá na tela: um evento de 5 min ocupa
 * o espaço de `minDuration`, e é esse espaço que conta para a sobreposição.
 */
export function layoutColumns(items: TimedItem[], minDuration = 20): PlacedItem[] {
  const sorted = items
    .map((item) => ({ ...item, visualEnd: Math.max(item.end, item.start + minDuration) }))
    .sort((a, b) => a.start - b.start || b.visualEnd - a.visualEnd || a.id.localeCompare(b.id));

  const result: PlacedItem[] = [];
  let cluster: (typeof sorted)[number][] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;
  const columnOf = new Map<string, number>();

  const flush = () => {
    const columns = columnEnds.length;
    for (const item of cluster) {
      const column = columnOf.get(item.id)!;
      let span = 1;
      for (let next = column + 1; next < columns; next++) {
        const blocked = cluster.some(
          (other) =>
            columnOf.get(other.id) === next &&
            other.start < item.visualEnd &&
            item.start < other.visualEnd
        );
        if (blocked) break;
        span++;
      }
      result.push({ id: item.id, start: item.start, end: item.end, column, columns, span });
    }
    cluster = [];
    columnEnds = [];
  };

  for (const item of sorted) {
    if (item.start >= clusterEnd && cluster.length) flush();
    let column = columnEnds.findIndex((end) => end <= item.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.visualEnd);
    } else {
      columnEnds[column] = item.visualEnd;
    }
    columnOf.set(item.id, column);
    cluster.push(item);
    clusterEnd = cluster.length === 1 ? item.visualEnd : Math.max(clusterEnd, item.visualEnd);
  }
  if (cluster.length) flush();

  return result;
}
