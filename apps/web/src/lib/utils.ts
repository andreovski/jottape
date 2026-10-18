import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Os tamanhos de texto do iOS (`text-body`, `text-caption-2`...) são classes próprias
 * (styles/index.css). Sem registrá-los, o tailwind-merge os lê como cor e apaga um deles quando a
 * mesma lista tem `text-label-2`.
 */
export const TEXT_STYLES = [
  'large-title',
  'title-1',
  'title-2',
  'title-3',
  'headline',
  'body',
  'callout',
  'subhead',
  'footnote',
  'caption',
  'caption-2',
];

const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: TEXT_STYLES }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
