import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import pluginReact from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    // server.mjs é o servidor estático de produção: roda em Node puro, não no
    // navegador (process, console de Node etc.).
    files: ['server.mjs'],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.recommended,
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': 'warn',
      'simple-import-sort/exports': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-param-reassign': ['warn', { props: true }],
    },
  },
  pluginReact.configs.flat.recommended,
  pluginReact.configs.flat['jsx-runtime'],
  // eslint-plugin-react-hooks 7 expoe o formato flat em `configs.flat`;
  // `configs['recommended-latest']` ainda e o formato eslintrc antigo.
  reactHooks.configs.flat['recommended-latest'],
  eslintConfigPrettier,
  {
    settings: { react: { version: 'detect' } },
  },
  {
    ignores: ['**/*.cjs', 'dist/**', 'dev-dist/**', 'coverage/**'],
  },
]);
