import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

// Mesma chave ('theme') e mesma classe ('dark') do script inline do index.html.
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute='class' defaultTheme='system' enableSystem storageKey='theme'>
      {children}
    </NextThemesProvider>
  );
}
