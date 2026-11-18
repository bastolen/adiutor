/**
 * @file Tests for describing IP addresses.
 */
import { describe, expect, it } from 'vitest';

import { describeIpAddress } from './ip-address';

describe('describeIpAddress', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:0db8:85a3:0000:0000:0000:0000:0000', '2001:db8:85a3::'],
    ['2001:0db8:0000:0001:0000:0000:0000:0001', '2001:db8:0:1::1'],
  ])('describes %s as the address %s', (address, short) => {
    expect(describeIpAddress(address)).toEqual({ kind: 'address', address: short });
  });

  it.each(['0000:0000:0000:0000:0000:0000:0000:0000', '::1', '127.0.0.1', '::ffff:127.0.0.1'])(
    'describes %s as this computer',
    (address) => {
      expect(describeIpAddress(address)).toEqual({ kind: 'local', address: '' });
    },
  );

  it.each([null, undefined, ''])('describes %j as unknown', (address) => {
    expect(describeIpAddress(address)).toEqual({ kind: 'unknown', address: '' });
  });
});
