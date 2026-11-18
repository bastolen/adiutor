/**
 * @file Formats IP addresses for people: IPv6 addresses in their short form
 * (Better Auth stores them expanded and masked to their /64 network), and
 * this computer's own addresses and a missing one as a `kind` that the
 * `common.ipAddress` message words ("Local", "Unknown") in the reader's language.
 */

/**
 * Shortens an expanded IPv6 address: drops leading zeros in each group and
 * replaces the longest run of zero groups with `::`.
 *
 * @param address - The address, e.g. `2001:0db8:0000:0000:0000:0000:0000:0001`.
 * @returns The short form, e.g. `2001:db8::1`.
 */
function compressIpv6(address: string): string {
  const groups = address.split(':').map((group) => group.replace(/^0+(?=.)/, ''));
  if (groups.length !== 8) {
    return address;
  }
  let best = { start: -1, length: 0 };
  let run = { start: -1, length: 0 };
  groups.forEach((group, index) => {
    if (group === '0') {
      run = run.start === -1 ? { start: index, length: 1 } : { ...run, length: run.length + 1 };
      if (run.length > best.length) {
        best = run;
      }
    } else {
      run = { start: -1, length: 0 };
    }
  });
  if (best.length < 2) {
    return groups.join(':');
  }
  const head = groups.slice(0, best.start).join(':');
  const tail = groups.slice(best.start + best.length).join(':');
  return `${head}::${tail}`;
}

/**
 * An address as the `common.ipAddress` message takes it:
 * `t('ipAddress', describeIpAddress(ip))`. `kind` says whether it is this
 * computer's own address (`local`), not known (`unknown`) or an address to
 * show as it is (`address`, with the address in its short form in `address`;
 * empty for the other two). A record rather than an interface, so it fits a
 * message's values.
 */
export type IpAddressDescription = Record<'kind' | 'address', string>;

/**
 * Describes an IP address for display. The words "Local" and "Unknown" are
 * the message's, so each reader gets them in their own language.
 *
 * @param address - The stored address, if known.
 * @returns The kind of address and, for a real one, its short form.
 */
export function describeIpAddress(address: string | null | undefined): IpAddressDescription {
  if (!address) {
    return { kind: 'unknown', address: '' };
  }
  const short = address.includes(':') ? compressIpv6(address.toLowerCase()) : address;
  if (
    short === '::' ||
    short === '::1' ||
    short.startsWith('127.') ||
    short === '::ffff:127.0.0.1'
  ) {
    return { kind: 'local', address: '' };
  }
  return { kind: 'address', address: short };
}
