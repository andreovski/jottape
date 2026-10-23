import type { CategoryResponse, TransactionKind } from '@jottape/schemas';
import {
  ArrowLeftRight,
  Baby,
  BadgePercent,
  Banknote,
  Bike,
  Bitcoin,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  ChartCandlestick,
  CircleEllipsis,
  CirclePlus,
  Coffee,
  Coins,
  createLucideIcon,
  CreditCard,
  Droplet,
  Dumbbell,
  FileText,
  Flame,
  Fuel,
  Gamepad2,
  Gem,
  Gift,
  GraduationCap,
  Hammer,
  HandCoins,
  HandHeart,
  HeartPulse,
  House,
  Landmark,
  Laptop,
  type LucideIcon,
  PartyPopper,
  PawPrint,
  Percent,
  PiggyBank,
  Pill,
  Plane,
  Receipt,
  Repeat,
  Scissors,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sofa,
  Sparkles,
  Store,
  Tag,
  Ticket,
  TrendingUp,
  Tv,
  Umbrella,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react';
import { createElement } from 'react';

import { IconChip } from '@/components/ios/list';
import { useCategories } from '@/features/finance';

import { styledCategory } from './finance-utils';

/** O símbolo do Pix (marca pública do Banco Central), preenchido na cor do ícone. */
export const PixIcon = createLucideIcon('pix', [
  [
    'path',
    {
      key: 'pix',
      fill: 'currentColor',
      stroke: 'none',
      d: 'M5.283 18.36a3.505 3.505 0 0 0 2.493-1.032l3.6-3.6a.684.684 0 0 1 .946 0l3.613 3.613a3.504 3.504 0 0 0 2.493 1.032h.71l-4.56 4.56a3.647 3.647 0 0 1-5.156 0L4.85 18.36ZM18.428 5.627a3.505 3.505 0 0 0-2.493 1.032l-3.613 3.614a.67.67 0 0 1-.946 0l-3.6-3.6A3.505 3.505 0 0 0 5.283 5.64h-.434l4.573-4.572a3.646 3.646 0 0 1 5.156 0l4.559 4.559ZM1.068 9.422 3.79 6.699h1.492a2.483 2.483 0 0 1 1.744.722l3.6 3.6a1.73 1.73 0 0 0 2.443 0l3.614-3.613a2.482 2.482 0 0 1 1.744-.723h1.767l2.737 2.737a3.646 3.646 0 0 1 0 5.156l-2.736 2.736h-1.768a2.482 2.482 0 0 1-1.744-.722l-3.613-3.613a1.77 1.77 0 0 0-2.444 0l-3.6 3.6a2.483 2.483 0 0 1-1.744.722H3.791l-2.723-2.723a3.646 3.646 0 0 1 0-5.156',
    },
  ],
]);

/**
 * Ícones que uma categoria pode ter, na ordem do seletor (agrupados por assunto,
 * de 6 em 6 para fechar as linhas da grade). O `name` é o que fica salvo na categoria.
 */
export const CATEGORY_ICONS: { name: string; label: string; icon: LucideIcon }[] = [
  { name: 'briefcase', label: 'Salário', icon: Briefcase },
  { name: 'wallet', label: 'Carteira', icon: Wallet },
  { name: 'banknote', label: 'Dinheiro', icon: Banknote },
  { name: 'coins', label: 'Moedas', icon: Coins },
  { name: 'hand-coins', label: 'Reembolso', icon: HandCoins },
  { name: 'piggy-bank', label: 'Poupança', icon: PiggyBank },
  { name: 'trending-up', label: 'Investimentos', icon: TrendingUp },
  { name: 'chart-candlestick', label: 'Ações', icon: ChartCandlestick },
  { name: 'bitcoin', label: 'Cripto', icon: Bitcoin },
  { name: 'landmark', label: 'Banco', icon: Landmark },
  { name: 'pix', label: 'Pix', icon: PixIcon },
  { name: 'arrow-left-right', label: 'Transferência', icon: ArrowLeftRight },
  { name: 'credit-card', label: 'Cartão', icon: CreditCard },
  { name: 'receipt', label: 'Contas e boletos', icon: Receipt },
  { name: 'percent', label: 'Juros e taxas', icon: Percent },
  { name: 'home', label: 'Moradia', icon: House },
  { name: 'sofa', label: 'Móveis', icon: Sofa },
  { name: 'hammer', label: 'Obras e reparos', icon: Hammer },
  { name: 'zap', label: 'Luz', icon: Zap },
  { name: 'droplet', label: 'Água', icon: Droplet },
  { name: 'flame', label: 'Gás', icon: Flame },
  { name: 'wifi', label: 'Internet', icon: Wifi },
  { name: 'smartphone', label: 'Celular', icon: Smartphone },
  { name: 'shopping-cart', label: 'Mercado', icon: ShoppingCart },
  { name: 'utensils', label: 'Alimentação', icon: Utensils },
  { name: 'coffee', label: 'Café', icon: Coffee },
  { name: 'shopping-bag', label: 'Compras', icon: ShoppingBag },
  { name: 'shirt', label: 'Roupas', icon: Shirt },
  { name: 'store', label: 'Loja', icon: Store },
  { name: 'car', label: 'Carro', icon: Car },
  { name: 'fuel', label: 'Combustível', icon: Fuel },
  { name: 'bus', label: 'Transporte público', icon: Bus },
  { name: 'bike', label: 'Bicicleta', icon: Bike },
  { name: 'plane', label: 'Viagem', icon: Plane },
  { name: 'wrench', label: 'Manutenção', icon: Wrench },
  { name: 'heart-pulse', label: 'Saúde', icon: HeartPulse },
  { name: 'pill', label: 'Farmácia', icon: Pill },
  { name: 'dumbbell', label: 'Academia', icon: Dumbbell },
  { name: 'scissors', label: 'Beleza', icon: Scissors },
  { name: 'baby', label: 'Filhos', icon: Baby },
  { name: 'paw-print', label: 'Pets', icon: PawPrint },
  { name: 'party-popper', label: 'Lazer', icon: PartyPopper },
  { name: 'ticket', label: 'Ingressos', icon: Ticket },
  { name: 'gamepad', label: 'Jogos', icon: Gamepad2 },
  { name: 'tv', label: 'Streaming', icon: Tv },
  { name: 'graduation-cap', label: 'Educação', icon: GraduationCap },
  { name: 'book-open', label: 'Livros', icon: BookOpen },
  { name: 'repeat', label: 'Assinaturas', icon: Repeat },
  { name: 'shield-check', label: 'Seguros', icon: ShieldCheck },
  { name: 'file-text', label: 'Impostos', icon: FileText },
  { name: 'gift', label: 'Presentes', icon: Gift },
  { name: 'gem', label: 'Joias', icon: Gem },
  { name: 'hand-heart', label: 'Doações', icon: HandHeart },
  { name: 'laptop', label: 'Eletrônicos', icon: Laptop },
  { name: 'badge-percent', label: 'Cashback e descontos', icon: BadgePercent },
  { name: 'umbrella', label: 'Reserva de emergência', icon: Umbrella },
  { name: 'sparkles', label: 'Limpeza', icon: Sparkles },
  { name: 'plus-circle', label: 'Outras receitas', icon: CirclePlus },
  { name: 'circle-ellipsis', label: 'Outros', icon: CircleEllipsis },
  { name: 'tag', label: 'Geral', icon: Tag },
];

const ICONS: Record<string, LucideIcon> = Object.fromEntries(
  CATEGORY_ICONS.map(({ name, icon }) => [name, icon])
);

export function categoryIconOf(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name]) || Tag;
}

/** Círculo na cor da categoria com o ícone dela; transferências são cinza com setas. */
export function CategoryIcon({
  category,
  kind,
  size = 'md',
}: {
  category?: CategoryResponse | null;
  kind?: TransactionKind;
  size?: 'sm' | 'md' | 'lg';
}) {
  // Subcategoria sem cor/ícone herda da mãe (a lista de categorias já está em cache).
  const { data: categories } = useCategories();
  const styled = styledCategory(category, categories ?? []);

  if (kind === 'TRANSFER') {
    return (
      <IconChip color='var(--gray)' size={size} round>
        <ArrowLeftRight strokeWidth={2.25} />
      </IconChip>
    );
  }
  return (
    <IconChip color={styled?.color ?? 'var(--gray)'} size={size} round>
      {createElement(categoryIconOf(styled?.icon), { strokeWidth: 2.25 })}
    </IconChip>
  );
}
