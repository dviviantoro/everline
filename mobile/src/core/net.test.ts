import { describe, expect, it } from 'vitest';

import { isIpv4 } from './net';

describe('isIpv4', () => {
  it('accepts dotted quads and ignores surrounding spaces', () => {
    expect(isIpv4('192.0.2.10')).toBe(true);
    expect(isIpv4(' 10.0.0.1 ')).toBe(true);
    expect(isIpv4('0.0.0.0')).toBe(true);
    expect(isIpv4('255.255.255.255')).toBe(true);
  });

  it('rejects everything else', () => {
    for (const text of ['', '192.0.2', '192.0.2.10.1', '256.0.0.1', '192.0.2.x', '192,0,2,10', 'cantol.local']) {
      expect(isIpv4(text)).toBe(false);
    }
  });
});
