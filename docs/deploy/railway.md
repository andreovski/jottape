# Deploy no Railway

O Jottape roda em dois serviços e um banco, no projeto `jottape` do Railway:

| Serviço       | O que é                                                                                         | Start                          |
| ------------- | ----------------------------------------------------------------------------------------------- | ------------------------------ |
| `jottape-api` | API Fastify + Prisma, com os jobs (lembretes, resumo do dia, sincronização com o Google)        | `node apps/api/dist/server.js` |
| `jottape-web` | PWA (Vite) servida por `apps/web/server.mjs`, que repassa `/api/*` para a API pela rede privada | `node apps/web/server.mjs`     |
| `Postgres`    | Postgres 17, criado pelo painel                                                                 | —                              |

A configuração dos dois serviços está em `.railway/railway.ts` (Railway IaC) e só muda com
`railway config plan` → `railway config apply`. O código vai para produção a cada push na `main`;
a CI (`.github/workflows/ci.yml`) roda lint, typecheck, testes, build e os e2e da API, e o portão é
não fazer merge com ela vermelha.

A API **não dorme**: os lembretes rodam num cron dentro dela a cada minuto. O navegador só fala com
o domínio do `jottape-web`, e o cookie de sessão é de primeira parte (funciona no Safari do iPhone).

## 1. Primeira vez

1. Crie o projeto `jottape` no Railway e, nele, um **Postgres 17** pelo painel (nome `Postgres`).
2. Na raiz do repositório: `pnpm install`, `railway login`, `railway link` (escolha o projeto).
3. `railway config plan` e, se o plano criar os dois serviços, `railway config apply`.
4. Gere um domínio público para o `jottape-web` (Settings › Networking › Generate Domain). A API
   não precisa de domínio público.
5. Defina os segredos (seção 2) e faça o primeiro deploy. O `preDeploy` da API roda as migrations
   e cria o dono (`OWNER_EMAIL`), com as categorias padrão e a lista "Entrada".
6. Abra o domínio do web no iPhone, entre e use "Compartilhar › Adicionar à Tela de Início". As
   notificações só funcionam com o app instalado assim (iOS 16.4 ou mais novo).

## 2. Variáveis

Segredo nunca vai no arquivo. Defina com `railway variable set --stdin`, por exemplo:

```bash
openssl rand -hex 32 | railway variable set JWT_SECRET --stdin --service jottape-api
openssl rand -hex 32 | railway variable set ENCRYPTION_KEY --stdin --service jottape-api
```

| Variável                                                 | Serviço  | Para quê                                                                                                                                            |
| -------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                           | api      | Referência `${{Postgres.DATABASE_URL}}` (já no arquivo).                                                                                            |
| `APP_URL`, `FRONTEND_URL`                                | api      | Domínio do web (já no arquivo, por referência). O Google volta para `${APP_URL}/api/google/callback`.                                               |
| `TRUST_PROXY`                                            | api      | `true`: a API está atrás do proxy do Railway e do `server.mjs`.                                                                                     |
| `OWNER_EMAIL`                                            | api      | O seu e-mail: o dono, criado a cada deploy se ainda não existe. Os outros usuários entram pelo cadastro.                                            |
| `OWNER_NAME`                                             | api      | Nome mostrado no app.                                                                                                                               |
| `OWNER_PASSWORD`                                         | api      | Senha inicial, usada só quando o dono é criado. Depois troque em Ajustes e pode apagar a variável.                                                  |
| `SIGNUP_CODE`                                            | api      | Código de convite da tela "Criar conta". Sem ele o cadastro fica fechado; trocar invalida o código antigo.                                          |
| `JWT_SECRET`                                             | api      | **Obrigatória**: assina a sessão. Sem ela a API não sobe em produção. Trocar derruba as sessões.                                                    |
| `ENCRYPTION_KEY`                                         | api      | **Obrigatória**: 32 bytes (hex ou base64) que cifram o refresh token do Google no banco. Trocar exige reconectar o Google.                          |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`               | api      | Login com o Google, Agenda e Tarefas (seção 3). Sem elas o app funciona sem Google.                                                                 |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`         | api      | Agenda do Outlook / Microsoft 365 (seção 3b). Sem elas a opção da Microsoft não aparece.                                                            |
| `ANTHROPIC_API_KEY`                                      | api      | Liga o Assistente (Claude Haiku lê o pedido), só para o dono e `ASSISTANT_EMAILS`. Sem ela a aba não aparece.                                       |
| `ASSISTANT_EMAILS`                                       | api      | Quem usa o Assistente além do dono (beta), e-mails separados por vírgula. Sem ela, só o dono.                                                       |
| `JEV_API_KEY`                                            | api      | Jev (TypeSafe): confere tipo, conta e categoria e dá o score. Sem ela nada é salvo sozinho, tudo vira rascunho.                                     |
| `GROQ_API_KEY`                                           | api      | Transcrição do áudio no servidor (Whisper na Groq, chave em console.groq.com). Sem ela o microfone usa a voz do navegador, que não existe em todos. |
| `ASSISTANT_MONTHLY_LIMIT`                                | api      | Pedidos por usuário por mês (padrão 300). O dono não tem limite.                                                                                    |
| `ASSISTANT_MODEL`, `JEV_MODEL`, `TRANSCRIPTION_MODEL`    | api      | Opcionais: trocam os modelos (padrão `claude-haiku-5-5`, `jev-latest`, `whisper-large-v3-turbo`).                                                   |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | api      | Notificações (seção 4). Sem elas não há lembretes por push.                                                                                         |
| `HOST`                                                   | api      | `::` (já no arquivo): a rede privada do Railway pode ser só IPv6.                                                                                   |
| `PORT`                                                   | api, web | `8080` e `4173` (já no arquivo).                                                                                                                    |
| `API_URL`                                                | web      | Endereço privado da API (já no arquivo, por referência).                                                                                            |

## 3. Google (Agenda, Tarefas e login)

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto e ative a
   **Google Calendar API** e a **Google Tasks API**.
2. Em "Tela de consentimento OAuth": tipo **Externo**, com o seu e-mail como usuário de teste, e
   depois **Publicar o app** ("Em produção"). Não precisa verificar: o Google mostra o aviso de
   "app não verificado" (siga em "Avançado"), o que basta para uso pessoal. Deixar em "Teste" faz o
   refresh token vencer em 7 dias e a sincronização para.
3. Em "Credenciais", crie um **ID do cliente OAuth** do tipo "Aplicativo da Web" com o URI de
   redirecionamento `https://<domínio do web>/api/google/callback` (e
   `http://localhost:5173/api/google/callback` para o dev).
4. Defina `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` na API.
5. No app, Ajustes › Google › Conectar. A partir daí, a agenda recebe as mudanças do Google por
   webhook (`events.watch`, só em HTTPS) e, de qualquer forma, a cada 15 minutos; as tarefas, a
   cada 5 minutos.

O login pelo Google só aceita quem já tem conta (pelo e-mail ou pela conta Google ligada em Ajustes): ele não cria usuário.

## 3b. Microsoft (Agenda do Outlook)

1. No [Microsoft Entra](https://entra.microsoft.com/) (portal do Azure, serve conta pessoal), em
   "Registros de aplicativo" › **Novo registro**: tipos de conta **"Contas em qualquer diretório
   organizacional e contas pessoais da Microsoft"**, plataforma **Web** e URI de redirecionamento
   `https://<domínio do web>/api/microsoft/callback` (e `http://localhost:5173/api/microsoft/callback`
   para o dev).
2. Em "Permissões de API", adicione do Microsoft Graph, do tipo **delegada**: `Calendars.ReadWrite`,
   `User.Read` e `offline_access`.
3. Em "Certificados e segredos", crie um **segredo do cliente** e copie o **Valor** (não o ID). O
   segredo vence (até 24 meses): anote a data e troque antes.
4. Defina `MICROSOFT_CLIENT_ID` (o "ID do aplicativo (cliente)") e `MICROSOFT_CLIENT_SECRET` na API.
5. No app, Ajustes › Calendários › Adicionar conta Microsoft. A Microsoft é só para a Agenda (sem
   login nem tarefas); as mudanças chegam por webhook (assinatura renovada sozinha, só em HTTPS) e
   a cada 15 minutos. Eventos repetidos do Outlook aparecem como ocorrências soltas: a repetição se
   muda no próprio Outlook.

## 4. Notificações (Web Push)

```bash
pnpm --filter api exec web-push generate-vapid-keys
```

Defina `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (`mailto:<seu e-mail>`) na API.
Trocar as chaves invalida as inscrições: é preciso ligar as notificações de novo em Ajustes.

## 5. Backup e restauração

O Postgres do Railway tem backups no painel (Backups). Para uma cópia própria, use a
`DATABASE_PUBLIC_URL` do serviço Postgres (aba Variables):

```bash
pg_dump "<DATABASE_PUBLIC_URL>" > jottape.sql
```

Ajustes › Exportar dados também baixa tudo em JSON e os lançamentos em CSV (abre no Excel e no
Numbers).
