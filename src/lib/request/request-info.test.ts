/**
 * @file Tests for reading request info from headers.
 */
import { describe, expect, it } from 'vitest';

import { requestInfoFromHeaders } from './request-info';

describe('requestInfoFromHeaders', () => {
  it('trusts a single-value IP header', () => {
    expect(
      requestInfoFromHeaders(
        new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'Firefox' }),
      ),
    ).toEqual({ ip: '203.0.113.7', userAgent: 'Firefox' });
  });

  it("doesn't take the forgeable left end of a forwarded chain", () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.66, 203.0.113.7' });
    // Without trusted proxies, a chain isn't trusted at all (tests fall back to localhost).
    expect(requestInfoFromHeaders(headers).ip).not.toBe('198.51.100.66');
    // With the proxy trusted, the address it received the request from counts.
    expect(requestInfoFromHeaders(headers, { trustedProxies: ['203.0.113.0/24'] }).ip).toBe(
      '198.51.100.66',
    );
    expect(
      requestInfoFromHeaders(new Headers({ 'x-forwarded-for': '198.51.100.66, 192.0.2.9' }), {
        trustedProxies: ['203.0.113.0/24'],
      }).ip,
    ).toBe('192.0.2.9');
  });

  it('reads the configured headers', () => {
    const headers = new Headers({ 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '192.0.2.1' });
    expect(requestInfoFromHeaders(headers, { ipAddressHeaders: ['x-real-ip'] }).ip).toBe(
      '198.51.100.2',
    );
  });

  it('copes with missing headers', () => {
    expect(requestInfoFromHeaders(null)).toEqual({ ip: null, userAgent: null });
  });
});
