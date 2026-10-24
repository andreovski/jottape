import type { StockPeriod, StockQuote } from '@jottape/schemas';
import { useId } from 'react';

export const STOCK_PERIOD_LABELS: Record<StockPeriod, string> = {
  day: 'Hoje',
  week: '7 dias',
  month: 'Mês',
};

// Cores do app Ações do iOS: a linha clara o bastante para o céu escuro, o selo sólido para
// ficar legível também no céu claro.
const UP = { line: '#4ADE80', pill: '#30D158' };
const DOWN = { line: '#FF7A7A', pill: '#FF453A' };

const CURRENCY_SYMBOLS: Record<string, string> = { BRL: 'R$', USD: 'US$', EUR: '€', GBP: '£' };

const money = (value: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Linha do preço no período, sem eixos: só a curva, um degradê embaixo, o ponto de agora e a
 * base da comparação pontilhada.
 */
export function Sparkline({
  points,
  reference,
  color,
  width = 96,
  height = 34,
}: {
  points: number[];
  reference: number | null;
  color: string;
  width?: number;
  height?: number;
}) {
  const gradient = useId();
  if (points.length < 2) return null;
  const values = reference === null ? points : [...points, reference];
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const pad = 3;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v: number) => height - pad - ((v - low) / span) * (height - pad * 2);
  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${height} L${line.replaceAll(' ', ' L')} L${x(points.length - 1).toFixed(1)},${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <linearGradient id={gradient} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor={color} stopOpacity={0.35} />
          <stop offset='1' stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {reference !== null && (
        <line
          x1={0}
          x2={width}
          y1={y(reference)}
          y2={y(reference)}
          stroke='rgb(255 255 255 / 0.35)'
          strokeDasharray='2 3'
        />
      )}
      <path d={area} fill={`url(#${gradient})`} />
      <polyline
        points={line}
        fill='none'
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin='round'
        strokeLinecap='round'
      />
      <circle cx={x(points.length - 1)} cy={y(points.at(-1)!)} r={2.6} fill={color} />
    </svg>
  );
}

/** Uma linha por ação: código e preço, o gráfico e a variação. */
export function StockList({ stocks }: { stocks: StockQuote[] }) {
  return (
    <div className='-mb-1'>
      {stocks.map((stock) => {
        const up = (stock.change ?? 0) >= 0;
        const color = up ? UP : DOWN;
        return (
          <div
            key={stock.ticker}
            className='flex items-center gap-3 border-t border-white/10 py-2.5 first:border-t-0 first:pt-1'
          >
            <div className='min-w-0 flex-1'>
              <div className='text-[17px] font-semibold text-white'>{stock.ticker}</div>
              <div className='text-footnote numeric text-white/70'>
                {CURRENCY_SYMBOLS[stock.currency] ?? stock.currency} {money(stock.price)}
              </div>
            </div>
            <Sparkline points={stock.points} reference={stock.reference} color={color.line} />
            {stock.change !== null && (
              <span
                className='text-footnote numeric min-w-[62px] rounded-lg px-1.5 py-1 text-center font-semibold text-white'
                style={{ backgroundColor: color.pill }}
              >
                {up ? '+' : '−'}
                {(Math.abs(stock.change) * 100).toLocaleString('pt-BR', {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
                %
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
