import type { SVGProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Ícone do Jotta: uma tecla com o J em fonte mono (serifa reta) e o cursor ao lado. Segue o traço
 * dos ícones do lucide (24 × 24, `currentColor`, pontas redondas) para conviver com eles nas abas.
 */
export function JottaIcon({ className, strokeWidth = 2, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={24}
      height={24}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={strokeWidth}
      strokeLinecap='round'
      strokeLinejoin='round'
      className={cn('lucide', className)}
      {...props}
    >
      <rect x='3' y='3' width='18' height='18' rx='5.5' />
      <path d='M9.5 7.5h4.5' />
      <path d='M12.5 7.5v6a2.75 2.75 0 0 1-5.4.7' />
      <path d='M16 16.5h.01' strokeWidth={Number(strokeWidth) * 1.6} />
    </svg>
  );
}
