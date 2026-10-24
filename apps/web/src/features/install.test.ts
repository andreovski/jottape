import { afterEach, describe, expect, it, vi } from 'vitest';

import { dismissInviteForever, shouldInvite, snoozeInvite } from './install';

const phone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1';

describe('convite de instalação', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('não convida no computador', () => {
    expect(shouldInvite()).toBe(false);
  });

  it('convida no celular, some ao adiar e volta depois de 7 dias', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(phone);
    const now = Date.now();
    expect(shouldInvite(now)).toBe(true);
    snoozeInvite(now);
    expect(shouldInvite(now + 6 * 86_400_000)).toBe(false);
    expect(shouldInvite(now + 8 * 86_400_000)).toBe(true);
  });

  it('"não mostrar mais" vale para sempre', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(phone);
    dismissInviteForever();
    expect(shouldInvite(Date.now() + 365 * 86_400_000)).toBe(false);
  });
});
