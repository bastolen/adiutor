/**
 * @file Tests for the guard that keeps webhooks out of Adiutor's own network:
 * which addresses are refused, IPv4 inside IPv6, the networks an operator
 * allows, and the lookup that checks every address a name resolves to.
 * @vitest-environment node
 */
import type { LookupAddress } from 'node:dns';

import { describe, expect, it, vi } from 'vitest';

import {
  addressRules,
  guardedLookup,
  isRefusedAddress,
  pointsInside,
  RefusedAddressError,
  type ResolveAll,
} from './address-guard';

// The server's own allowed networks aren't used here: every check is given its rules.
vi.mock('@/lib/env', () => ({ env: { WEBHOOK_ALLOWED_NETWORKS: [] } }));

const none = addressRules([]);

/**
 * A resolver that answers every name with the given addresses.
 *
 * @param addresses - The addresses to answer with.
 * @returns The resolver.
 */
function resolvingTo(...addresses: string[]): ResolveAll {
  return (_hostname, _options, callback) => {
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );
  };
}

/**
 * A resolver that finds no address for any name, as for a host that doesn't exist.
 *
 * @param error - The error it fails with.
 * @returns The resolver.
 */
function failingWith(error: Error): ResolveAll {
  return (_hostname, _options, callback) => {
    callback(error, []);
  };
}

describe('isRefusedAddress', () => {
  it('refuses the private, loopback, link-local and other internal IPv4 ranges', () => {
    [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '127.8.9.10',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.170',
      '192.0.2.1',
      '192.168.1.10',
      '198.18.0.1',
      '198.51.100.7',
      '203.0.113.9',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
    ].forEach((address) => {
      expect(isRefusedAddress(address, none), address).toBe(true);
    });
  });

  it('refuses the internal IPv6 ranges', () => {
    [
      '::',
      '::1',
      'fc00::1',
      'fd00:ec2::254',
      'fe80::1',
      'fe80::1%eth0',
      'fec0::1',
      'ff02::1',
      '2001:db8::1',
      '2001::1',
      '2002:7f00:1::1',
      '64:ff9b:1::1',
      '100::1',
      '::ffff:0:808:808',
      '::ffff:0:10.0.0.1',
    ].forEach((address) => {
      expect(isRefusedAddress(address, none), address).toBe(true);
    });
  });

  it('judges IPv4 written inside IPv6 as the IPv4 it holds', () => {
    expect(isRefusedAddress('::ffff:127.0.0.1', none)).toBe(true);
    expect(isRefusedAddress('::ffff:7f00:1', none)).toBe(true);
    expect(isRefusedAddress('::ffff:169.254.169.254', none)).toBe(true);
    expect(isRefusedAddress('64:ff9b::10.0.0.1', none)).toBe(true);
    expect(isRefusedAddress('::ffff:93.184.216.34', none)).toBe(false);
    expect(isRefusedAddress('64:ff9b::93.184.216.34', none)).toBe(false);
  });

  it('lets public addresses through', () => {
    ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::6810:84e5'].forEach(
      (address) => {
        expect(isRefusedAddress(address, none), address).toBe(false);
      },
    );
  });

  it('refuses anything that isn’t an IP address', () => {
    expect(isRefusedAddress('localhost', none)).toBe(true);
    expect(isRefusedAddress('', none)).toBe(true);
  });

  it('lets the networks an operator allowed through, and nothing next to them', () => {
    const rules = addressRules(['127.0.0.1', '10.20.0.0/16', 'fd00:1::/32']);
    expect(isRefusedAddress('127.0.0.1', rules)).toBe(false);
    expect(isRefusedAddress('::ffff:127.0.0.1', rules)).toBe(false);
    expect(isRefusedAddress('127.0.0.2', rules)).toBe(true);
    expect(isRefusedAddress('10.20.5.6', rules)).toBe(false);
    expect(isRefusedAddress('10.21.0.1', rules)).toBe(true);
    expect(isRefusedAddress('fd00:1::5', rules)).toBe(false);
    expect(isRefusedAddress('fd00:2::5', rules)).toBe(true);
  });

  it('keeps each allowed network to its own family', () => {
    const everyIpv6 = addressRules(['::/0']);
    expect(isRefusedAddress('fd00::1', everyIpv6)).toBe(false);
    expect(isRefusedAddress('10.0.0.1', everyIpv6)).toBe(true);
    expect(isRefusedAddress('::ffff:10.0.0.1', everyIpv6)).toBe(true);
    expect(isRefusedAddress('127.0.0.1', everyIpv6)).toBe(true);

    const everyIpv4 = addressRules(['0.0.0.0/0']);
    expect(isRefusedAddress('10.0.0.1', everyIpv4)).toBe(false);
    expect(isRefusedAddress('::ffff:10.0.0.1', everyIpv4)).toBe(false);
    expect(isRefusedAddress('fd00::1', everyIpv4)).toBe(true);
    expect(isRefusedAddress('::1', everyIpv4)).toBe(true);
  });
});

describe('guardedLookup', () => {
  /**
   * Runs a lookup and gives what it called back with.
   *
   * @param resolve - The resolver behind it.
   * @param all - Whether every address is asked for, as Node.js does when it tries several.
   * @returns The error, or the addresses.
   */
  function lookUp(
    resolve: ResolveAll,
    all: boolean,
  ): Promise<{ error: Error | null; address: string | LookupAddress[]; family?: number }> {
    return new Promise((done) => {
      guardedLookup(none, resolve)('hooks.adiutor.dev', { all }, (error, address, family) => {
        done({ error, address, family });
      });
    });
  }

  it('gives the addresses of a public name, one or all as asked', async () => {
    const resolve = resolvingTo('93.184.216.34', '2606:4700::6810:84e5');
    expect(await lookUp(resolve, false)).toEqual({
      error: null,
      address: '93.184.216.34',
      family: 4,
    });
    expect((await lookUp(resolve, true)).address).toHaveLength(2);
  });

  it('refuses a name when any of its addresses is internal, so none of them is tried', async () => {
    const { error } = await lookUp(resolvingTo('93.184.216.34', '10.0.0.5'), true);
    expect(error).toBeInstanceOf(RefusedAddressError);
    expect((await lookUp(resolvingTo('127.0.0.1'), false)).error).toBeInstanceOf(
      RefusedAddressError,
    );
  });

  it('refuses a name without addresses, and passes on a failed lookup', async () => {
    expect((await lookUp(resolvingTo(), false)).error).toBeInstanceOf(RefusedAddressError);
    const notFound = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    expect((await lookUp(failingWith(notFound), false)).error).toBe(notFound);
  });
});

describe('pointsInside', () => {
  it('judges an address in the URL without looking it up', async () => {
    const resolve = vi.fn<ResolveAll>();
    expect(await pointsInside(new URL('http://127.0.0.1:4000/hook'), none, resolve)).toBe(true);
    expect(await pointsInside(new URL('http://[::1]:4000/hook'), none, resolve)).toBe(true);
    expect(await pointsInside(new URL('http://2130706433/hook'), none, resolve)).toBe(true);
    expect(await pointsInside(new URL('https://93.184.216.34/hook'), none, resolve)).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('judges a name by every address it resolves to, and lets a name that isn’t found pass', async () => {
    const url = new URL('https://hooks.adiutor.dev/in');
    expect(await pointsInside(url, none, resolvingTo('93.184.216.34'))).toBe(false);
    expect(await pointsInside(url, none, resolvingTo('93.184.216.34', '192.168.0.2'))).toBe(true);
    const notFound = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    expect(await pointsInside(url, none, failingWith(notFound))).toBe(false);
  });
});
