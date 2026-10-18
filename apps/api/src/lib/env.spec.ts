import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAllowedOrigins, getPort } from './env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getAllowedOrigins', () => {
  it('usa o dev do Vite quando FRONTEND_URL não existe', () => {
    vi.stubEnv('FRONTEND_URL', '');
    expect(getAllowedOrigins()).toEqual(['http://localhost:5173']);
  });

  it('separa várias origens por vírgula', () => {
    vi.stubEnv('FRONTEND_URL', 'https://a.example.com, https://b.example.com');
    expect(getAllowedOrigins()).toEqual(['https://a.example.com', 'https://b.example.com']);
  });
});

describe('getPort', () => {
  it('cai na 3333 sem PORT', () => {
    vi.stubEnv('PORT', '');
    expect(getPort()).toBe(3333);
  });
});
