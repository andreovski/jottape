// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { caminhoNaApi, criarServidor, ehApi, resolverArquivo } from './server.mjs';

const raiz = mkdtempSync(join(tmpdir(), 'jottape-web-'));
mkdirSync(join(raiz, 'assets'));
writeFileSync(join(raiz, 'index.html'), '<html></html>');
writeFileSync(join(raiz, 'sw.js'), '');
writeFileSync(join(raiz, 'assets', 'app-abc123.js'), '');

describe('resolverArquivo', () => {
  it('serve asset com hash como imutável', () => {
    expect(resolverArquivo(raiz, '/assets/app-abc123.js')).toMatchObject({
      imutavel: true,
      semCache: false,
      fallback: false,
    });
  });

  it('nunca cacheia o service worker', () => {
    expect(resolverArquivo(raiz, '/sw.js')).toMatchObject({ semCache: true });
  });

  it('cai no index.html nas rotas da SPA', () => {
    expect(resolverArquivo(raiz, '/agenda?dia=2026-10-18')).toMatchObject({
      arquivo: join(raiz, 'index.html'),
      fallback: true,
    });
  });

  it('dá 404 para bundle ou ícone inexistente', () => {
    expect(resolverArquivo(raiz, '/assets/sumiu.js')).toBeNull();
    expect(resolverArquivo(raiz, '/icons/nao-existe.png')).toBeNull();
  });

  it('não sai da raiz', () => {
    const fora = resolverArquivo(raiz, '/%2e%2e/%2e%2e/etc/passwd');
    expect(fora === null || fora.arquivo.startsWith(raiz)).toBe(true);
  });

  it('não lança com escape inválido', () => {
    expect(resolverArquivo(raiz, '/%ZZ')).toBeNull();
  });
});

describe('repasse para a API', () => {
  it('reconhece só /api e subcaminhos', () => {
    expect(ehApi('/api')).toBe(true);
    expect(ehApi('/api/health?x=1')).toBe(true);
    expect(ehApi('/apiario')).toBe(false);
  });

  it('tira o prefixo /api', () => {
    expect(caminhoNaApi('/api/health?x=1')).toBe('/health?x=1');
    expect(caminhoNaApi('/api')).toBe('/');
  });

  let api: Server;
  let web: Server;
  let webUrl: string;

  beforeAll(async () => {
    api = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ url: request.url, method: request.method }));
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

    web = criarServidor({ apiUrl });
    await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
    webUrl = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => web.close(resolve));
    await new Promise((resolve) => api.close(resolve));
  });

  it('repassa a requisição sem o prefixo', async () => {
    const response = await fetch(`${webUrl}/api/health?x=1`, { method: 'POST', body: '{}' });
    expect(await response.json()).toEqual({ url: '/health?x=1', method: 'POST' });
  });

  it('responde 502 quando a API não responde', async () => {
    const parado = criarServidor({ apiUrl: 'http://127.0.0.1:1' });
    await new Promise<void>((resolve) => parado.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(parado.address() as AddressInfo).port}`;

    const response = await fetch(`${url}/api/health`);
    expect(response.status).toBe(502);

    await new Promise((resolve) => parado.close(resolve));
  });
});
