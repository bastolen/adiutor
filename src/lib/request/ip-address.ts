/**
 * @file Formats IP addresses for people: IPv6 addresses in their short form
 * (Better Auth stores them expanded and masked to their /64 network), and
 * this computer's own addresses as "Local".
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
 * Formats an IP address for display.
 *
 * @param address - The stored address, if known.
 * @returns The address, "Local" for this computer, or "Unknown".
 */
export default function formatIpAddress(address: string | null | undefined): string {
  if (!address) {
    return 'Unknown';
  }
  const short = address.includes(':') ? compressIpv6(address.toLowerCase()) : address;
  if (
    short === '::' ||
    short === '::1' ||
    short.startsWith('127.') ||
    short === '::ffff:127.0.0.1'
  ) {
    return 'Local';
  }
  return short;
}
