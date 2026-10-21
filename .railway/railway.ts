import { defineRailway, github, preserve, project, service } from 'railway/iac';

// Configuração dos serviços do Railway (projeto jottape, ambiente production), no molde da Arttevo.
// Muda o Railway só quando alguém roda `railway config apply`; o código vai pelo push na main.
// Roteiro completo em docs/deploy/railway.md.
//
// Segredos nunca têm valor aqui: ficam `preserve()` e são definidos com
// `railway variable set --stdin`.
//
// O partial deixa o Postgres fora deste arquivo: ele é criado pelo painel (Postgres 17), e o
// `apply` só mexe no que está declarado aqui.
export const partial = 'apps';

const ROOT_FILES = ['/package.json', '/pnpm-lock.yaml', '/pnpm-workspace.yaml', '/turbo.json'];

export default defineRailway(() => {
  const repo = github('andreovski/jottape', { checkSuites: false });

  const api = service('jottape-api', {
    source: repo,
    build: {
      buildCommand: 'pnpm --filter=api... run build',
      builder: 'RAILPACK',
      watchPatterns: ['/apps/api/**', '/packages/**', ...ROOT_FILES],
    },
    // Migration com erro para o deploy aqui, e a API anterior continua no ar. O seed só cria o
    // dono quando ele ainda não existe.
    preDeploy:
      'pnpm --filter api exec prisma migrate deploy && node apps/api/dist/scripts/seed-owner.js',
    start: 'node apps/api/dist/server.js',
    healthcheck: '/health',
    // Sem dormir: os lembretes, o resumo do dia e a sincronização com o Google rodam dentro da API.
    networking: { privateNetworkEndpoint: 'jottape-api' },
    env: {
      NODE_ENV: 'production',
      PORT: '8080',
      // A rede privada do Railway pode ser só IPv6: escuta em todas as famílias.
      HOST: '::',
      TRUST_PROXY: 'true',
      DATABASE_URL: '${{Postgres.DATABASE_URL}}',
      APP_URL: 'https://${{jottape-web.RAILWAY_PUBLIC_DOMAIN}}',
      FRONTEND_URL: 'https://${{jottape-web.RAILWAY_PUBLIC_DOMAIN}}',
      OWNER_EMAIL: preserve(),
      OWNER_NAME: preserve(),
      OWNER_PASSWORD: preserve(),
      SIGNUP_CODE: preserve(),
      JWT_SECRET: preserve(),
      ENCRYPTION_KEY: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      MICROSOFT_CLIENT_ID: preserve(),
      MICROSOFT_CLIENT_SECRET: preserve(),
      ANTHROPIC_API_KEY: preserve(),
      ASSISTANT_EMAILS: preserve(),
      ASSISTANT_MODEL: preserve(),
      ASSISTANT_MONTHLY_LIMIT: preserve(),
      JEV_API_KEY: preserve(),
      JEV_MODEL: preserve(),
      BENCH_TOKEN: preserve(),
      GROQ_API_KEY: preserve(),
      TRANSCRIPTION_MODEL: preserve(),
      VAPID_PUBLIC_KEY: preserve(),
      VAPID_PRIVATE_KEY: preserve(),
      VAPID_SUBJECT: preserve(),
    },
  });

  const web = service('jottape-web', {
    source: repo,
    build: {
      buildCommand: 'pnpm --filter=web... run build',
      builder: 'RAILPACK',
      watchPatterns: ['/apps/web/**', '/packages/**', ...ROOT_FILES],
    },
    start: 'node apps/web/server.mjs',
    // O Railway recusa ponto no caminho do healthcheck: `/` devolve o index.html.
    healthcheck: '/',
    env: {
      PORT: '4173',
      // `/api/*` vai para a API pela rede privada (um domínio só, cookie de sessão de primeira parte).
      API_URL: 'http://${{jottape-api.RAILWAY_PRIVATE_DOMAIN}}:${{jottape-api.PORT}}',
    },
  });

  return project('jottape', { resources: [api, web] });
});
