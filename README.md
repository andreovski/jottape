# Jottape

Agenda, tarefas e finanças pessoais num app só, para uso pessoal. É uma PWA (instala no iPhone pela
"Adicionar à Tela de Início") com backend próprio, no visual dos apps da Apple.

- **Hoje**: saldo com a previsão de 30 dias, o próximo compromisso, o anel das tarefas e as contas
  do dia.
- **Agenda**: dia, semana e mês, eventos recorrentes, integrada ao Google Agenda nos dois sentidos.
- **Tarefas**: listas, listas inteligentes (Hoje, Programadas, Atrasadas...), subtarefas, etiquetas,
  recorrência e lembretes, sincronizadas com o Google Tarefas.
- **Finanças**: contas, cartões com fatura, parcelamento, recorrência, transferências, orçamentos por
  categoria e a previsão de saldo.
- **Lembretes** por notificação (Web Push) e um resumo do dia.

## Estrutura

Monorepo pnpm + Turborepo, no molde da Arttevo:

| Pasta                     | O que é                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/api`                | API Fastify + Prisma (Postgres), com os jobs de lembrete e sincronização                 |
| `apps/web`                | SPA Vite + React 19, TanStack Router e Query, Tailwind 4; `server.mjs` serve em produção |
| `packages/schemas`        | Schemas Zod e tipos que a API e o web dividem                                            |
| `packages/finance-engine` | Regras puras de dinheiro e datas: recorrência, parcelas, fatura, saldo, orçamento        |

## Rodando local

```bash
pnpm install
docker compose up -d                 # Postgres 17 na porta 5432
cp apps/api/.env.example apps/api/.env  # e preencha OWNER_EMAIL e OWNER_PASSWORD
pnpm --filter api exec prisma migrate deploy
pnpm --filter api seed               # cria o dono, as categorias padrão e a lista "Entrada"
pnpm dev                             # API em :3333, web em :5173
```

Comandos da raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Os e2e da API rodam com
`pnpm --filter api test:e2e` contra o banco `jottape_test`.

## Deploy

Railway, com a configuração em `.railway/railway.ts`. Roteiro, variáveis, Google e notificações em
[`docs/deploy/railway.md`](docs/deploy/railway.md).
