/**
 * @file Tests for formatting IP addresses.
 */
import { describe, expect, it } from 'vitest';

import formatIpAddress from './ip-address';

describe('formatIpAddress', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:0db8:85a3:0000:0000:0000:0000:0000', '2001:db8:85a3::'],
    ['2001:0db8:0000:0001:0000:0000:0000:0001', '2001:db8:0:1::1'],
    ['0000:0000:0000:0000:0000:0000:0000:0000', 'Local'],
    ['::1', 'Local'],
    ['127.0.0.1', 'Local'],
    [null, 'Unknown'],
  ])('formats %s as %s', (address, expected) => {
    expect(formatIpAddress(address)).toBe(expected);
  });
});
