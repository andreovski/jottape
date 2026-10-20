import type { BriefingPluginId } from '@jottape/schemas';
import {
  CalendarDays,
  CalendarHeart,
  ChartCandlestick,
  CircleDollarSign,
  Clock,
  CloudSun,
  Flame,
  Hourglass,
  Moon,
  PiggyBank,
  Quote,
  Receipt,
  Sparkles,
  Sunset,
  TrendingDown,
  TrendingUp,
  Waves,
} from 'lucide-react';
import type { ReactNode } from 'react';

export interface BriefingPluginInfo {
  name: string;
  description: string;
  icon: ReactNode;
  color: string;
  /** Busca dados fora do app. */
  external?: boolean;
}

/** Nome, explicação e ícone de cada plugin do briefing (a lista e a ordem vêm da API). */
export const briefingCatalog: Record<BriefingPluginId, BriefingPluginInfo> = {
  day: {
    name: 'Resumo do dia',
    description: 'Compromissos e tarefas de hoje, e o próximo horário.',
    icon: <CalendarDays />,
    color: 'var(--red)',
  },
  free: {
    name: 'Horário livre',
    description: 'O maior intervalo sem compromissos até as 20h.',
    icon: <Clock />,
    color: 'var(--teal)',
  },
  bills: {
    name: 'Contas da semana',
    description: 'O que vence nos próximos 7 dias e faturas perto de fechar.',
    icon: <Receipt />,
    color: 'var(--green)',
  },
  balance: {
    name: 'Alerta de saldo',
    description: 'Avisa quando a previsão mostra o saldo ficando negativo.',
    icon: <TrendingDown />,
    color: 'var(--red)',
  },
  budget: {
    name: 'Orçamento',
    description: 'Categorias que já passaram de 80% do orçamento do mês.',
    icon: <PiggyBank />,
    color: 'var(--pink)',
  },
  stale: {
    name: 'Tarefas paradas',
    description: 'A tarefa atrasada há mais tempo, ou uma sem data esquecida.',
    icon: <Hourglass />,
    color: 'var(--orange)',
  },
  yesterday: {
    name: 'Ontem',
    description: 'Tarefas concluídas e quanto você gastou ontem.',
    icon: <Sunset />,
    color: 'var(--indigo)',
  },
  month: {
    name: 'Gastos do mês',
    description: 'Quanto já saiu este mês, comparado ao mesmo ponto do mês passado.',
    icon: <TrendingUp />,
    color: 'var(--mint)',
  },
  streak: {
    name: 'Sequência',
    description: 'Dias seguidos fechando todas as tarefas do dia.',
    icon: <Flame />,
    color: 'var(--orange)',
  },
  weather: {
    name: 'Clima',
    description: 'Temperatura agora, máxima, mínima e chance de chuva.',
    icon: <CloudSun />,
    color: 'var(--cyan)',
    external: true,
  },
  tide: {
    name: 'Maré',
    description: 'Se a maré está subindo ou baixando e as próximas alta e baixa.',
    icon: <Waves />,
    color: 'var(--blue)',
    external: true,
  },
  horoscope: {
    name: 'Horóscopo',
    description: 'O horóscopo do dia para o seu signo.',
    icon: <Sparkles />,
    color: 'var(--purple)',
    external: true,
  },
  currency: {
    name: 'Cotação',
    description: 'Dólar, euro, libra e bitcoin em reais, com a variação.',
    icon: <CircleDollarSign />,
    color: 'var(--green)',
    external: true,
  },
  stocks: {
    name: 'Ações',
    description: 'O preço das ações que você escolher, com a variação do dia.',
    icon: <ChartCandlestick />,
    color: 'var(--indigo)',
    external: true,
  },
  holidays: {
    name: 'Feriados',
    description: 'O próximo feriado nacional, se estiver perto.',
    icon: <CalendarHeart />,
    color: 'var(--yellow)',
    external: true,
  },
  moon: {
    name: 'Fase da lua',
    description: 'A fase de hoje e quanto está iluminada.',
    icon: <Moon />,
    color: 'var(--indigo)',
  },
  quote: {
    name: 'Ditado do dia',
    description: 'Um ditado popular diferente a cada dia.',
    icon: <Quote />,
    color: 'var(--brown)',
  },
};
