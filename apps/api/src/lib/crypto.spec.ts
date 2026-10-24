import { describe, expect, it } from 'vitest';

import { decrypt, encrypt } from './crypto';

describe('crypto', () => {
  it('cifra e decifra', () => {
    const secret = encrypt('1//refresh-token');
    expect(secret).not.toContain('refresh');
    expect(decrypt(secret)).toBe('1//refresh-token');
  });

  it('recusa conteúdo adulterado', () => {
    const secret = Buffer.from(encrypt('abc'), 'base64');
    secret[secret.length - 1] ^= 1;
    expect(() => decrypt(secret.toString('base64'))).toThrow();
  });
});
