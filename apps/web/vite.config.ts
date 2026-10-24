import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// Os pacotes entram pelo FONTE: o `dist` deles é CommonJS (feito para a API) e o Vite trata
// pacote linkado como código do projeto. Mesmo esquema do apps/dtf da Arttevo.
const alias = {
  '@': path.resolve(__dirname, './src'),
  '@jottape/finance-engine': path.resolve(__dirname, '../../packages/finance-engine/src'),
  '@jottape/schemas': path.resolve(__dirname, '../../packages/schemas/src'),
};

// Bibliotecas grandes em arquivos próprios: mudam pouco, e o navegador as guarda entre deploys.
const VENDOR_CHUNKS: Record<string, string[]> = {
  react: ['react', 'react-dom', 'scheduler'],
  charts: ['recharts', 'd3-', 'victory-vendor'],
  tanstack: ['@tanstack/'],
};

function vendorChunk(id: string) {
  if (!id.includes('node_modules')) return undefined;
  const path = id.split('node_modules/').at(-1) ?? '';
  for (const [chunk, prefixes] of Object.entries(VENDOR_CHUNKS)) {
    if (
      prefixes.some((prefix) =>
        path.startsWith(prefix.endsWith('/') || prefix.endsWith('-') ? prefix : `${prefix}/`)
      )
    ) {
      return chunk;
    }
  }
  return 'vendor';
}

export default defineConfig({
  build: { rollupOptions: { output: { manualChunks: vendorChunk } } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // O service worker é nosso (src/sw.ts): a etapa 3 põe nele o recebimento de Web Push.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Jottape',
        short_name: 'Jottape',
        description: 'Agenda, tarefas e finanças pessoais num lugar só.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#18181b',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Mesmo contrato da produção (server.mjs): /api/* vai para a API sem o prefixo.
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3333',
        changeOrigin: true,
        rewrite: (url) => url.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    globals: true,
    restoreMocks: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}', 'server.test.ts'],
    testTimeout: 15_000,
    alias,
  },
});
