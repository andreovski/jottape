# CLAUDE.md

Guia para o Claude Code (claude.ai/code) trabalhar neste repositório.

## O que é

Jottape: agenda, tarefas e finanças pessoais numa PWA, para **uso pessoal** do André e de quem ele
convidar. Não há cobrança nem distribuição. O dono é criado pelo seed (`OWNER_EMAIL`); os outros se
cadastram em "Criar conta" (`POST /users`) com o código de convite `SIGNUP_CODE` (sem ele o cadastro
fica fechado). O login pelo Google não cria conta. Todo dado tem `userId` e toda consulta filtra por
ele: regra nova também. Textos da interface em português do Brasil.

Monorepo pnpm + Turborepo, no molde da Arttevo:

- `apps/api`: Fastify 4 + Prisma 5 (Postgres). Rotas em `src/http/routes/` (sem prefixo `/api`),
  regras em `src/services/`, jobs em `src/jobs/`.
- `apps/web`: SPA Vite + React 19, TanStack Router (rotas em código, `src/router.tsx`) e Query,
  Tailwind 4. Em produção, `server.mjs` serve `dist/` e repassa `/api/*` para a API sem o prefixo.
- `packages/schemas`: Zod e tipos de corpo e resposta, usados pelos dois lados.
- `packages/finance-engine`: funções puras de dinheiro e datas (recorrência, parcelas, ciclo da
  fatura, saldo projetado, orçamento). Regra nova de cálculo entra aqui, com teste.

`packages/*` exportam de `dist/`: rode `pnpm --filter=api... run build` (com os `...`) numa
checkout limpa antes de rodar a API.

## Comandos

```bash
pnpm dev | build | lint | typecheck | test     # da raiz, via Turborepo
pnpm --filter api test:e2e                     # e2e contra o banco jottape_test (recriado)
pnpm --filter api seed                         # dono, categorias padrão e lista "Entrada"
```

## Regras que não aparecem no código à primeira vista

- **Dinheiro em centavos inteiros**, sempre. Datas de lançamento são `DATE` (`toDbDate`/`fromDbDate`);
  "hoje" é no fuso do usuário (`todayIn`). Lançamento com data até hoje nasce `DONE`, futuro nasce
  `PLANNED`.
- **Cartão**: cada lançamento do cartão (menos o pagamento) ganha `invoiceId` por `ensureInvoice`.
  Pagar a fatura cria uma transferência com `paysInvoiceId`; apagar esse pagamento reabre a fatura.
- **Recorrência de lançamentos**: a `Recurrence` guarda o modelo e as ocorrências são geradas até 12
  meses à frente (`extendRecurrences`, todo dia). Editar com `future` muda o modelo e as próximas
  que não foram editadas à parte; apagar com `future` põe `UNTIL` na regra.
- **Eventos** seguem o modelo do Google: o mestre tem a `rrule`, a exceção tem `recurringEventId` +
  `originalStartAt`, e ocorrência apagada é uma exceção `CANCELLED`. Dia inteiro é guardado em
  meia-noite UTC com fim exclusivo e expandido sem fuso.
- **Google**: o usuário pode conectar várias contas (`GoogleConnection`); toda chamada ao Google é
  por conta (`googleFetch(connectionId, …)`), e só a conta com `syncTasks` sincroniza o Google Tasks.
  O calendário padrão fica no `User`. Refresh token cifrado (AES-256-GCM, `ENCRYPTION_KEY`). Agenda por `syncToken` (410 →
  sincronização completa) e webhook `events.watch` só com `APP_URL` em HTTPS; tarefas por
  `updatedMin`. Mudança local pendente (`syncState: PENDING`) vence a do Google.
- **Microsoft** (Outlook): `GoogleConnection` com `provider: MICROSOFT`, só Agenda, pelo Graph
  (`graphFetch`, refresh token trocado a cada renovação). O delta traz ocorrências já expandidas,
  então evento da Microsoft não tem `rrule` local; série criada no Jottape vai como `recurrence` e
  volta como ocorrências.
- **Lembretes**: tabela `Reminder` com `nextFireAt`; o job de cada minuto marca antes de enviar e
  descarta o que atrasou mais de 1 h. Tarefa só com data é lembrada às 09:00 locais.
- **Briefing** (tela Hoje): cada plugin é uma função em `services/briefing/index.ts` que devolve
  frases montadas em `text.ts` (funções puras, com teste). Dinheiro do usuário vai como `{0}` +
  `values` em centavos, para o app poder ocultar. Plugin novo entra em `briefingPluginIds`
  (schemas) e no `briefingCatalog` (web); quem já salvou ajustes recebe ele desligado. Serviços de
  fora passam por `cached()` (tabela `ExternalCache`, igual para todos) e, se falharem, o plugin
  só some.
- **Assistente** (aba do chat): `services/assistant`. O Haiku lê o pedido em JSON estruturado
  (`haiku.ts`), o Jev confere tipo, conta e categoria com probabilidade (`jev.ts`, opções por
  `opcao_N` na ordem das contas/categorias), e `resolve.ts` (puro, com teste) monta o rascunho e o
  score. Também cria eventos (sem horário falta `time`; fim padrão +1 h, no calendário padrão) e
  tarefas (lista nomeada ou Entrada), pelos mesmos serviços das telas (`assistant/create.ts`).
  Score ≥ 0,85 sem nada faltando salva sozinho, com Desfazer no cartão; sem o Jev nunca
  salva sozinho. Cada pedido grava `AssistantUsage` com o custo estimado (limite mensal por
  usuário, o dono sem limite). Só o dono e os e-mails de `ASSISTANT_EMAILS` veem o Assistente.
  A conversa some em 30 dias.
- Jobs rodam dentro da API (não há agendador externo); desligados em teste e com `DISABLE_JOBS=true`.
  Por isso a API **não dorme** no Railway.

## Visual

A linguagem é a dos apps da Apple; regras e peças em `apps/web/DESIGN.md`. Use as peças de
`src/components/ios` e os tamanhos de texto do iOS (`text-body`, `text-footnote`...), que estão
registrados no `cn` (`src/lib/utils.ts`) para o tailwind-merge não apagá-los junto de uma cor.

## Deploy

Railway, com `.railway/railway.ts` (só muda com `railway config plan` → `apply`) e push na `main`
como deploy. Roteiro e variáveis em `docs/deploy/railway.md`; variável nova lida pelo código entra no
arquivo do Railway e na tabela do roteiro. A CI (`.github/workflows/ci.yml`) é o portão: não faça
merge com ela vermelha.
