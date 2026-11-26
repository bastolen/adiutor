/**
 * @file Keeps webhooks out of Adiutor's own network. A webhook's address is
 * typed by a staff Admin, and the server connects to it, so without a check
 * it could reach what only the server reaches: a database's admin page,
 * another service on the local network, the cloud's metadata service (and
 * its credentials). Every address a host name resolves to is checked in the
 * request's own `lookup`, so the address checked is the one connected to
 * (a name that resolves to a public address for a check and an internal one
 * for the connection can't slip through), and an IP address in the URL
 * itself, which is never looked up, is checked before connecting. Refused:
 * the private, loopback, link-local, shared (CGNAT), multicast, reserved,
 * documentation and benchmarking ranges, in IPv4 and IPv6, and IPv4 written
 * inside IPv6 is judged as the IPv4 it holds. An operator may allow chosen
 * networks (`WEBHOOK_ALLOWED_NETWORKS`), e.g. a receiver on the local
 * network; nobody in the app can.
 */
import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

import { env } from '@/lib/env';

/** IPv4 ranges a webhook never reaches, as network and prefix length. */
const REFUSED_IPV4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // "this network"; 0.0.0.0 reaches the server itself on Linux
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared address space (carrier-grade NAT)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, where clouds serve their metadata (169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['192.88.99.0', 24], // 6to4 relays, deprecated
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and the broadcast address 255.255.255.255
];

/**
 * IPv6 ranges a webhook never reaches, as network and prefix length.
 * IPv4-mapped addresses (`::ffff:0:0/96`) aren't listed: they're judged as
 * the IPv4 they hold.
 */
const REFUSED_IPV6: readonly (readonly [string, number])[] = [
  ['::', 96], // unspecified (::), loopback (::1) and the deprecated IPv4-compatible form
  ['::ffff:0:0:0', 96], // IPv4-translated (SIIT), never routed on the internet
  ['64:ff9b:1::', 48], // NAT64 for local use
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments, among them Teredo and benchmarking
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4, which holds an IPv4 address
  ['3fff::', 20], // documentation
  ['fc00::', 7], // unique local, where some clouds serve their metadata (fd00:ec2::254)
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local, deprecated
  ['ff00::', 8], // multicast
];

/** An IP address family, as Node.js names them. */
type Family = 'ipv4' | 'ipv6';

/**
 * Lists of addresses that Node.js checks addresses against, one per family.
 * Never one list for both: Node.js's `BlockList` matches an IPv4 address
 * against an IPv6 range by its IPv4-mapped form and the other way round, so
 * `::/0` would hold every IPv4 address, and `0.0.0.0/0` every IPv4-mapped one.
 */
type Lists = Readonly<Record<Family, BlockList>>;

/**
 * Lists of networks, each in the list of its own family.
 *
 * @param networks - Each network's address, prefix length (`undefined` for a
 *   single address) and family.
 * @returns The lists.
 */
function listsOf(networks: readonly (readonly [string, number | undefined, Family])[]): Lists {
  const lists = { ipv4: new BlockList(), ipv6: new BlockList() };
  networks.forEach(([address, prefix, family]) => {
    if (prefix === undefined) {
      lists[family].addAddress(address, family);
    } else {
      lists[family].addSubnet(address, prefix, family);
    }
  });
  return lists;
}

/** The ranges above, in the lists Node.js checks addresses against. */
const REFUSED = listsOf([
  ...REFUSED_IPV4.map(([network, prefix]) => [network, prefix, 'ipv4'] as const),
  ...REFUSED_IPV6.map(([network, prefix]) => [network, prefix, 'ipv6'] as const),
]);

/** Where webhooks may send: the networks an operator allowed inside the refused ranges. */
export interface AddressRules {
  /** The allowed networks, one list per family, which win over the refused ranges. */
  allowed: Lists;
}

/**
 * The rules for a list of allowed networks.
 *
 * @param networks - IP addresses or CIDR ranges, as `WEBHOOK_ALLOWED_NETWORKS` holds them.
 * @returns The rules.
 */
export function addressRules(networks: readonly string[]): AddressRules {
  return {
    allowed: listsOf(
      networks.map((network) => {
        const [address = '', prefix] = network.split('/');
        const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
        return [address, prefix === undefined ? undefined : Number(prefix), family] as const;
      }),
    ),
  };
}

/** The server's own rules, from its environment, made once. */
let serverRules: AddressRules | null = null;

/**
 * The rules from the server's environment (`WEBHOOK_ALLOWED_NETWORKS`).
 *
 * @returns The rules.
 */
export function serverAddressRules(): AddressRules {
  serverRules ??= addressRules(env.WEBHOOK_ALLOWED_NETWORKS);
  return serverRules;
}

/**
 * An IPv6 address's eight 16-bit groups.
 *
 * @param address - An IPv6 address, without a zone (`%eth0`).
 * @returns The groups, or `null` when it isn't an IPv6 address.
 */
function ipv6Groups(address: string): number[] | null {
  if (isIP(address) !== 6) {
    return null;
  }
  // The URL parser writes it in hexadecimal groups, also the dotted IPv4 tail of ::ffff:1.2.3.4.
  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const [head = '', tail] = canonical.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':');
  const groups =
    tail === undefined
      ? headGroups
      : [
          ...headGroups,
          ...Array<string>(8 - headGroups.length - tailGroups.length).fill('0'),
          ...tailGroups,
        ];
  return groups.map((group) => Number.parseInt(group, 16));
}

/**
 * The IPv4 address an IPv6 address stands for, where it holds one that's
 * routed as IPv4: IPv4-mapped (`::ffff:a.b.c.d`) and the well-known NAT64
 * prefix (`64:ff9b::a.b.c.d`), which IPv6-only networks reach IPv4 through.
 *
 * @param address - An IPv6 address.
 * @returns The IPv4 address, or `null` when it holds none.
 */
function embeddedIpv4(address: string): string | null {
  const groups = ipv6Groups(address);
  if (groups === null) {
    return null;
  }
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = groups;
  const mapped = a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff;
  const nat64 = a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0;
  return mapped || nat64
    ? [Math.floor(g / 256), g % 256, Math.floor(h / 256), h % 256].join('.')
    : null;
}

/**
 * Whether a webhook may not connect to an address: it's in a refused range
 * and not in a network the operator allowed. An IPv6 address that holds an
 * IPv4 address is judged as that IPv4 address only, so allowing an IPv6
 * range never lets an internal IPv4 address through. Anything that isn't an
 * IP address is refused.
 *
 * @param address - The IP address, as a lookup gives it or the URL holds it.
 * @param rules - The allowed networks.
 * @returns Whether it's refused.
 */
export function isRefusedAddress(address: string, rules: AddressRules): boolean {
  const bare = address.split('%')[0] ?? '';
  const family = isIP(bare);
  if (family === 0) {
    return true;
  }
  const inside = family === 6 ? embeddedIpv4(bare) : null;
  if (inside !== null) {
    return isRefusedAddress(inside, rules);
  }
  const type = family === 4 ? 'ipv4' : 'ipv6';
  return !rules.allowed[type].check(bare, type) && REFUSED[type].check(bare, type);
}

/** A webhook's address that points inside Adiutor's own network: the connection is never made. */
export class RefusedAddressError extends Error {
  /** A code of its own, as Node.js gives its network errors one. */
  readonly code = 'ADIUTOR_REFUSED_ADDRESS';

  /** Makes the error, without the address (nothing may log it). */
  constructor() {
    super('The webhook points inside Adiutor’s own network.');
    this.name = 'RefusedAddressError';
  }
}

/** Looks up every address of a host name, as `dns.lookup` with `all: true` does. */
export type ResolveAll = (
  hostname: string,
  options: LookupAllOptions,
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * Node.js's own lookup, for every address of a host name.
 *
 * @param hostname - The host name.
 * @param options - The lookup's options, with `all: true`.
 * @param callback - Called with the addresses, or the error.
 */
const resolveWithDns: ResolveAll = (hostname, options, callback) => {
  dnsLookup(hostname, options, callback);
};

/**
 * A `lookup` for `http.request` that refuses a host name when any address it
 * resolves to is refused ({@link isRefusedAddress}), with a
 * {@link RefusedAddressError}, so the connection goes only to an address that
 * was checked. Every address counts, not just the first, as the connection
 * may try any of them.
 *
 * @param rules - The allowed networks.
 * @param resolve - How names are looked up; Node.js's own unless a test gives one.
 * @returns The lookup.
 */
export function guardedLookup(
  rules: AddressRules,
  resolve: ResolveAll = resolveWithDns,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, '');
        return;
      }
      const [first] = addresses;
      if (
        first === undefined ||
        addresses.some(({ address }) => isRefusedAddress(address, rules))
      ) {
        callback(new RefusedAddressError(), '');
        return;
      }
      if (options.all) {
        callback(null, addresses);
      } else {
        callback(null, first.address, first.family);
      }
    });
  };
}

/**
 * Whether a webhook's address points inside Adiutor's own network now, to
 * refuse it when it's saved: its IP address, or any address its host name
 * resolves to. A name that can't be looked up passes here (it may exist by
 * the time anything is sent); every connection checks again.
 *
 * @param url - The webhook's address, already checked by `webhookUrlProblem`.
 * @param rules - The allowed networks.
 * @param resolve - How names are looked up; Node.js's own unless a test gives one.
 * @returns Whether it's refused.
 */
export function pointsInside(
  url: URL,
  rules: AddressRules,
  resolve: ResolveAll = resolveWithDns,
): Promise<boolean> {
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(host) !== 0) {
    return Promise.resolve(isRefusedAddress(host, rules));
  }
  return new Promise((done) => {
    resolve(host, { all: true }, (error, addresses) => {
      done(error === null && addresses.some(({ address }) => isRefusedAddress(address, rules)));
    });
  });
}
