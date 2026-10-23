import { describe, expect, it } from 'vitest';

import { icsHost, isPrivateAddress, normalizeIcsUrl } from './fetch';

describe('normalizeIcsUrl', () => {
  it('troca webcal por https e recusa o que não é http(s)', () => {
    expect(
      normalizeIcsUrl(' webcal://outlook.office365.com/owa/calendar/x/reachcalendar.ics ')
    ).toBe('https://outlook.office365.com/owa/calendar/x/reachcalendar.ics');
    expect(normalizeIcsUrl('https://example.com/a.ics')).toBe('https://example.com/a.ics');
    expect(normalizeIcsUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeIcsUrl('https://user:senha@example.com/a.ics')).toBeNull();
    expect(normalizeIcsUrl('não é link')).toBeNull();
  });

  it('icsHost mostra só o domínio', () => {
    expect(icsHost('https://outlook.office365.com/owa/calendar/segredo/calendar.ics')).toBe(
      'outlook.office365.com'
    );
  });
});

describe('isPrivateAddress', () => {
  it('bloqueia rede interna e deixa a internet', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.1',
      '172.20.0.1',
      '169.254.169.254',
      '::1',
      'fd12::1',
      '::ffff:10.0.0.1',
      '100.64.0.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ['52.96.0.1', '8.8.8.8', '2603:1036::1']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});
