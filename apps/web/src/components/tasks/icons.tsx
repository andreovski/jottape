import {
  AlarmClock,
  BookOpen,
  Briefcase,
  CalendarClock,
  Car,
  Check,
  Dumbbell,
  Gift,
  GraduationCap,
  Heart,
  House,
  Inbox,
  Layers,
  List,
  type LucideIcon,
  PawPrint,
  Plane,
  ShoppingCart,
  Star,
  Utensils,
  Wallet,
} from 'lucide-react';

import type { SmartIcon } from './task-logic';

/** Calendário com o número do dia, como o ícone de "Hoje" do Lembretes. */
export function TodayGlyph({ day, className }: { day: number; className?: string }) {
  return (
    <svg viewBox='0 0 24 24' className={className} fill='none' aria-hidden>
      <rect x='3' y='4.5' width='18' height='16' rx='3.5' stroke='currentColor' strokeWidth='2' />
      <path d='M3 9.5h18' stroke='currentColor' strokeWidth='2' />
      <text
        x='12'
        y='18.2'
        textAnchor='middle'
        fontSize='8.5'
        fontWeight='700'
        fill='currentColor'
        fontFamily='ui-rounded, -apple-system, system-ui, sans-serif'
      >
        {day}
      </text>
    </svg>
  );
}

const SMART_ICONS: Record<Exclude<SmartIcon, 'today'>, LucideIcon> = {
  scheduled: CalendarClock,
  overdue: AlarmClock,
  nodate: Inbox,
  all: Layers,
  completed: Check,
};

export function SmartViewIcon({ icon, day }: { icon: SmartIcon; day: number }) {
  if (icon === 'today') return <TodayGlyph day={day} />;
  const Icon = SMART_ICONS[icon];
  return <Icon strokeWidth={icon === 'completed' ? 3 : 2.25} />;
}

/** Ícones que uma lista pode ter (guardados pelo nome em `TaskList.icon`). */
export const LIST_ICONS: Record<string, LucideIcon> = {
  list: List,
  cart: ShoppingCart,
  house: House,
  briefcase: Briefcase,
  heart: Heart,
  star: Star,
  book: BookOpen,
  school: GraduationCap,
  gift: Gift,
  plane: Plane,
  car: Car,
  dumbbell: Dumbbell,
  food: Utensils,
  wallet: Wallet,
  pet: PawPrint,
};

export function ListIcon({ icon, inbox }: { icon: string | null; inbox?: boolean }) {
  const Icon = (icon && LIST_ICONS[icon]) || (inbox ? Inbox : List);
  return <Icon strokeWidth={2.5} />;
}
