/**
 * Servidor de produção do apps/web, no molde do apps/dtf da Arttevo.
 *
 * Sem dependências de propósito. Faz duas coisas:
 * - serve `dist/` e cai no index.html nas rotas da SPA (`/agenda`, `/tarefas`...);
 * - repassa `/api/*` para a API (sem o prefixo) pela rede privada do Railway, para o navegador
 *   falar com um domínio só e o cookie de sessão funcionar em qualquer navegador.
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('./dist', import.meta.url));

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

// Arquivos que o navegador precisa revalidar sempre: trocam a cada deploy sem mudar de nome.
const SEM_CACHE = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'registerSW.js']);

/** O caminho (já resolvido) é de `/api` ou um subcaminho dele? */
export function ehApi(urlPath) {
  const caminho = urlPath.split('?')[0];
  return caminho === '/api' || caminho.startsWith('/api/');
}

/** `/api/health?x=1` → `/health?x=1`. */
export function caminhoNaApi(urlPath) {
  const semPrefixo = urlPath.replace(/^\/api/, '');
  return semPrefixo.startsWith('/') ? semPrefixo : `/${semPrefixo}`;
}

export function resolverArquivo(raiz, urlPath) {
  // normalize ANTES de qualquer checagem, como no apps/dtf da Arttevo: `/../../etc/passwd` e a
  // versão percent-encoded (`%2e%2e`) viram um caminho que falha a checagem de raiz abaixo.
  let bruto;
  try {
    bruto = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    // Escape inválido (ex.: "%ZZ"): a função precisa ser total, senão uma URL derruba o processo.
    return null;
  }
  const caminho = normalize(bruto);

  const absoluto = join(raiz, caminho.replace(/^[/\\]+/, ''));
  if (absoluto !== raiz && !absoluto.startsWith(raiz + sep)) return null;

  try {
    if (statSync(absoluto).isFile()) {
      const nome = absoluto.slice(raiz.length + 1);
      return {
        arquivo: absoluto,
        fallback: false,
        // Decidido pelo caminho JÁ resolvido, nunca pela URL crua.
        imutavel: absoluto.startsWith(join(raiz, 'assets') + sep),
        semCache: SEM_CACHE.has(nome),
      };
    }
  } catch {
    // Não é arquivo: pode ser uma rota da SPA.
  }

  // Bundle inexistente tem que dar 404: servir HTML no lugar de JS quebra o app.
  if (caminho.startsWith(`${sep}assets${sep}`) || caminho.startsWith('/assets/')) return null;
  // Arquivo com extensão que não existe (ícone, imagem) também é 404, não a SPA.
  if (extname(caminho) !== '') return null;

  return { arquivo: join(raiz, 'index.html'), fallback: true, imutavel: false, semCache: true };
}

function repassarParaApi(apiUrl, request, response) {
  const destino = new URL(caminhoNaApi(request.url ?? '/'), apiUrl);
  const enviar = destino.protocol === 'https:' ? httpsRequest : httpRequest;

  const headers = { ...request.headers, host: destino.host };
  // A API confia no proxy (TRUST_PROXY) e lê o IP do fim desta lista.
  const ip = request.socket.remoteAddress;
  headers['x-forwarded-for'] = headers['x-forwarded-for']
    ? `${headers['x-forwarded-for']}, ${ip}`
    : ip;
  headers['x-forwarded-proto'] = headers['x-forwarded-proto'] ?? 'http';

  const saida = enviar(destino, { method: request.method, headers }, (resposta) => {
    response.writeHead(resposta.statusCode ?? 502, resposta.headers);
    resposta.pipe(response);
  });

  saida.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ message: 'API indisponível.' }));
    } else {
      response.destroy();
    }
  });

  request.pipe(saida);
}

function servirArquivo(request, response) {
  const resolvido = resolverArquivo(RAIZ, request.url ?? '/');

  if (resolvido === null) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Não encontrado');
    return;
  }

  const tipo = TIPOS[extname(resolvido.arquivo)] ?? 'application/octet-stream';
  const cache = resolvido.semCache
    ? 'no-cache'
    : resolvido.imutavel
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600';

  // setHeader (não writeHead): se o stream falhar antes do primeiro byte ainda dá para responder 500.
  response.setHeader('content-type', tipo);
  response.setHeader('cache-control', cache);

  const leitura = createReadStream(resolvido.arquivo);
  leitura.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Erro ao ler o arquivo');
    } else {
      response.destroy();
    }
  });
  leitura.pipe(response);
}

export function criarServidor({ apiUrl }) {
  return createServer((request, response) => {
    if (ehApi(request.url ?? '/')) {
      repassarParaApi(apiUrl, request, response);
      return;
    }
    servirArquivo(request, response);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const porta = Number(process.env.PORT) || 4173;
  const apiUrl = process.env.API_URL || 'http://localhost:3333';
  criarServidor({ apiUrl }).listen(porta, '0.0.0.0', () => {
    console.info(`apps/web servindo em http://0.0.0.0:${porta}/ (API em ${apiUrl})`);
  });
}
