import type { CategoryResponse, TransactionKind } from '@jottape/schemas';
import {
  ArrowLeftRight,
  Briefcase,
  Car,
  CircleEllipsis,
  CirclePlus,
  GraduationCap,
  HeartPulse,
  House,
  type LucideIcon,
  PartyPopper,
  Repeat,
  ShoppingCart,
  Tag,
  Utensils,
} from 'lucide-react';
import { createElement } from 'react';

import { IconChip } from '@/components/ios/list';
import { useCategories } from '@/features/finance';

import { styledCategory } from './finance-utils';

const ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  'plus-circle': CirclePlus,
  home: House,
  'shopping-cart': ShoppingCart,
  utensils: Utensils,
  car: Car,
  'heart-pulse': HeartPulse,
  'party-popper': PartyPopper,
  repeat: Repeat,
  'graduation-cap': GraduationCap,
  'circle-ellipsis': CircleEllipsis,
};

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
