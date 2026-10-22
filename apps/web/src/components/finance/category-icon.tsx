import type { CategoryResponse, TransactionKind } from '@jottape/schemas';
import {
  ArrowLeftRight,
  Baby,
  BadgePercent,
  Banknote,
  Bike,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  ChartCandlestick,
  CircleEllipsis,
  CirclePlus,
  Coffee,
  Coins,
  CreditCard,
  Droplet,
  Dumbbell,
  FileText,
  Flame,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
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
  { name: 'landmark', label: 'Banco', icon: Landmark },
  { name: 'credit-card', label: 'Cartão', icon: CreditCard },
  { name: 'receipt', label: 'Contas e boletos', icon: Receipt },
  { name: 'percent', label: 'Juros e taxas', icon: Percent },
  { name: 'home', label: 'Moradia', icon: House },
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
