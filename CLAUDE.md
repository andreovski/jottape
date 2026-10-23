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
- **Bancos** (Meu Pluggy, `services/bank`): grátis e aberto a todos, sem chave no servidor. Cada
  usuário cria a própria aplicação na Pluggy e salva Client ID/Secret (`PluggyCredential`, secret
  cifrado); o banco entra pelo widget Pluggy Connect (conector MeuPluggy) ou pelo ID do item. Cada banco do
  Meu Pluggy é um item (o token vai sem `avoidDuplicates`), e o widget não atualiza item do Meu
  Pluggy. Só a
  `BankAccount` ligada a uma `Account` traz lançamentos, a partir de `importFrom`. Cada lançamento
  do banco vira um `BankMovement` (único por conta + id externo, nunca apagado: é o que impede
  importar duas vezes): casa com um lançamento existente do mesmo valor e sentido em até 4 dias
  (parcela pelo número, até 45 dias; previsto vira efetivado) → MATCHED; pagamento de fatura visto
  no cartão → IGNORED; o resto fica PENDING em "A revisar" com a categoria do lançamento mais
  recente de mesmo tipo com descrição ou nota igual (a nota guarda o texto do banco); sem
  histórico, quem tem o Jotta recebe a da IA (Haiku num lote + Jev por item, só se concordam com
  Jev ≥ 0,6; `bank/ai.ts` e `ai-batch.ts`, uma vez por movimento, `aiCheckedAt`, custo
  `BANK_CATEGORY` fora do limite; `aiTrace` com tokens e custo de cada IA vai só para o dono, no
  modo dev; teste de acerto em `bank/benchmark.ts`, job "Teste de acerto da categoria do banco") e, por fim, vale a regra fixa da forma de pagamento (Pix, Débito, Crédito do cartão).
  Fonte em `suggestionSource`; o histórico sempre vence. **Transferência** (com Pix, Débito e
  Crédito) é categoria fixa (`Category.systemKey`), uma árvore por tipo, criada para todos: não
  se apaga nem se renomeia (`movements.ts`, puro, com teste). Aceitar usa `createTransactions`
  (a fatura sai sozinha). No cartão, a fatura do banco vale mais que a data: o `billId` (só depois
  que a fatura fecha) dá vencimento e fechamento (`billDueDate`/`billClosingDate` no movimento), e
  parcela 2+ datada pela fatura cai na que vence no mês da data; a cada sincronização o lançamento
  é movido para essa fatura. Fatura que o banco diz paga vira transferência da conta ligada onde o
  débito aparece (aceito, pendente ou já lançado como despesa); sem débito em conta ligada, foi
  paga por fora e fica paga sem tirar de conta nenhuma (e um pagamento sem débito numa conta
  ligada sai; o saldo do cartão soma de volta as faturas pagas por fora). A fatura do banco é
  achada pelo vencimento (±7 dias), não pelo mês do fechamento. Sem o pagamento na fatura do banco,
  `reconcileInvoicePayments` casa o débito "pagamento de fatura" (até 2% de diferença) ou boleto
  (valor exato) com a fatura de vencimento perto. "Conferir com o banco" (`cardCheck`) lê a
  Pluggy na hora e põe limite usado e faturas fechadas do banco ao lado das do Jottape. Job a cada 6 h; o Meu Pluggy só atualiza o banco uma vez por dia.
- **Lembretes**: tabela `Reminder` com `nextFireAt`; o job de cada minuto marca antes de enviar e
  descarta o que atrasou mais de 1 h. Tarefa só com data é lembrada às 09:00 locais.
- **Briefing** (tela Hoje): cada plugin é uma função em `services/briefing/index.ts` que devolve
  frases montadas em `text.ts` (funções puras, com teste). Dinheiro do usuário vai como `{0}` +
  `values` em centavos, para o app poder ocultar. Plugin novo entra em `briefingPluginIds`
  (schemas) e no `briefingCatalog` (web); quem já salvou ajustes recebe ele desligado. Serviços de
  fora passam por `cached()` (tabela `ExternalCache`, igual para todos) e, se falharem, o plugin
  só some.
- **Assistente** (aba do chat, que na interface se chama **Jotta**; no código segue `assistant`): `services/assistant`. O Haiku lê o pedido em JSON estruturado
  (`haiku.ts`), o Jev confere tipo, conta e categoria com probabilidade (`jev.ts`, opções por
  `opcao_N` na ordem das contas/categorias), e `resolve.ts` (puro, com teste) monta o rascunho e o
  score. Também cria eventos (sem horário falta `time`; fim padrão +1 h, no calendário padrão) e
  tarefas (lista nomeada ou Entrada), pelos mesmos serviços das telas (`assistant/create.ts`).
  Perguntas ("quanto gastei ontem?") vão para `answer.ts`: o Haiku chama ferramentas só de leitura
  (`queries.ts`, sempre com `userId`) e escreve dinheiro como `[[centavos]]`, que vira `{0}` +
  `values` na mensagem (o app oculta como no briefing).
  Mudanças ("o uber de ontem foi 35", "apaga o dentista", "marca o IPVA como feito") são o intent
  `change`: `change.ts` roda o mesmo laço de consultas com a ferramenta final `propor_mudanca`
  (pelo id que as consultas devolvem), confere a proposta no banco e monta um cartão com antes e
  depois, `apply` e `revert`. Mudança **nunca** salva sozinha; apagar não tem Desfazer.
  Cada resposta grava em `trace` os passos (Haiku, Jev, resposta) com tempo, tokens e custo; só
  o dono recebe (`devMode`), e a web mostra com o "Modo dev" dos Ajustes (localStorage).
  Score ≥ 0,85 sem nada faltando salva sozinho, com Desfazer no cartão; sem o Jev nunca
  salva sozinho. Cada pedido grava `AssistantUsage` com o custo estimado (limite mensal por
  usuário, o dono sem limite). Só o dono, os e-mails de `ASSISTANT_EMAILS` e os convidados do painel veem o Assistente.
  A conversa some em 30 dias.
  Memória por pessoa (`memory.ts`, `AssistantMemory`): conta ou categoria trocada (ou escolhida)
  no cartão vira preferência pela descrição normalizada; o histórico de lançamentos com a mesma
  descrição também sugere (`historyHints`, só quando um valor domina). Memória vence histórico;
  conta dita no pedido vence as duas. Concordando com o Jev, sobe a confiança; discordando, vale a
  memória e o cartão pede conferência. As 20 mais usadas vão nas instruções do Haiku; a pessoa vê
  e apaga em Ajustes › O que o Jotta aprendeu. Pedido ditado grava `voiceSeconds` (a linha do tempo mostra "voz · 3 s").
  Beta: o dono convida pelo painel (Ajustes › Beta do Assistente, `assistant/admin.ts`), que liga
  `User.assistantAccess` e muda `assistantLimit`; vê pedidos e custo do mês (`AssistantUsage`) e os
  números de 30 dias dos cartões (`autoSaved`, `edited`, e em `corrections` os campos trocados
  antes de salvar, comparados por `corrections.ts`) e dos `trace` (passo com falha leva `error`).
  "Isso está errado" copia o pedido, a resposta, os passos e o contexto do dia (nomes das contas,
  categorias e listas) em `AssistantFeedback`, que não some com a conversa; o dono transforma o
  relato em `AssistantTestCase` (resposta certa por nome). O teste de acerto (`benchmark.ts`, 50
  pedidos num dia fixo mais os casos ativos, cada um no seu dia e com os seus nomes) roda o Haiku
  e o Jev de verdade e grava o custo como `BENCHMARK`, fora do limite. Cada rodada vai para
  `AssistantBenchmarkRun`. Na CI, o job "Teste de acerto do Jotta" roda em PR que mexe no
  Assistente (`scripts/benchmark-ci.ts`): busca os casos em `/ci/assistant/cases` (`BENCH_TOKEN`),
  roda a base (em cache pelo commit) e o PR, repete o caso que quebrou e fica vermelho se ele
  falhar de novo. Evento e tarefa levam
  `notes` (descrição do evento, notas da tarefa) e `rrule` (o Haiku escreve a regra; `repeatOf`
  refaz só com frequência, intervalo e dias; tarefa que repete sem data começa hoje), e a tarefa
  leva `subtasks`, criadas como subtarefas.
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
