/**
 * @file Time zones: which ones Adiutor accepts, the zone everything falls
 * back to, the cookie that tells the server which zone a browser shows, and
 * the list people pick from. Free of server code, so the database schema,
 * Better Auth's config, the services and client components can import it.
 * See docs/i18n.md, "Time zones".
 */

/**
 * The zone times are shown in when nobody's zone is known and Adiutor has
 * none of its own yet (before setup): UTC.
 */
export const DEFAULT_TIME_ZONE = 'UTC';

/**
 * The cookie that tells the server which zone this browser shows times in.
 * It mirrors the signed-in account's zone: set at sign-in and whenever the
 * account's zone is saved, and removed at sign-out like every other cookie,
 * so a signed-out page shows Adiutor's default zone. Validated with
 * {@link isTimeZone} wherever it's read.
 */
export const TIME_ZONE_COOKIE = 'adiutor.time-zone';

/** The longest zone name accepted; the longest IANA names are about 30 characters. */
const MAX_TIME_ZONE_LENGTH = 64;

/** What a zone name is made of: letters, digits, `_`, `-`, `+` and `/` (e.g. `America/Port-au-Prince`). */
const TIME_ZONE_NAME = /^[A-Za-z0-9_+\-/]+$/;

/**
 * Whether a value is a time zone Adiutor accepts: an IANA name the runtime
 * knows, or `UTC`. Everything that saves or reads a zone checks it with this.
 *
 * The runtime may know a zone by another of its names: an older one
 * (`Asia/Calcutta` for `Asia/Kolkata`, `Europe/Kiev` for `Europe/Kyiv`) or a
 * newer one, depending on its version, and a browser's may differ from the
 * server's. So a name the runtime takes as another one's alias is accepted
 * as it's spelled, and only a name it knows as written in other letter case
 * is refused (`europe/amsterdam` for `Europe/Amsterdam`), so a saved zone is
 * spelled the way the list and the browsers spell it.
 *
 * @param value - The value, e.g. from a form, a cookie or the browser.
 * @returns Whether it's a zone.
 */
export function isTimeZone(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_TIME_ZONE_LENGTH ||
    !TIME_ZONE_NAME.test(value)
  ) {
    return false;
  }
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    // Not a zone the runtime knows.
    return false;
  }
  return resolved === value || resolved.toLowerCase() !== value.toLowerCase();
}

/**
 * A zone's offset from UTC at a moment, as "UTC+01:00", "UTC−05:00" or
 * "UTC" for no offset. It changes with daylight saving, so it's worked out
 * for a moment.
 *
 * @param timeZone - The zone.
 * @param at - The moment.
 * @returns The offset.
 */
export function timeZoneOffset(timeZone: string, at: Date): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find(({ type }) => type === 'timeZoneName')?.value;
  // `longOffset` writes "GMT+01:00", and "GMT" or "GMT+00:00" for no offset, by runtime.
  if (!name || /^GMT([+\-\u2212]00:00)?$/.test(name)) {
    return 'UTC';
  }
  return name.replace('GMT', 'UTC');
}

/** One zone to pick from. */
export interface TimeZoneOption {
  /** The zone's name, e.g. `Europe/Amsterdam`: what's saved. */
  value: string;
  /**
   * What the list shows: its name and its offset now, e.g. "Europe/Amsterdam
   * (UTC+01:00)", or only the name when that's the offset ("UTC").
   */
  label: string;
}

/**
 * Every zone the runtime knows, and `UTC`, by name, each with its offset at
 * a moment. A zone that isn't in the runtime's list (an older name a browser
 * still reports, like `Asia/Calcutta`) is added when it's the one chosen.
 *
 * @param at - The moment the offsets are for (now).
 * @param chosen - The zone chosen now, so it's always in the list.
 * @returns The options.
 */
export function timeZoneOptions(at: Date, chosen?: string): TimeZoneOption[] {
  const zones = new Set([DEFAULT_TIME_ZONE, ...Intl.supportedValuesOf('timeZone')]);
  if (chosen !== undefined && isTimeZone(chosen)) {
    zones.add(chosen);
  }
  return [...zones]
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((value) => {
      const offset = timeZoneOffset(value, at);
      return { value, label: value === offset ? value : `${value} (${offset})` };
    });
}

/**
 * The zone this browser is set to, as the browser reports it, or `null` when
 * it reports none Adiutor accepts. Only in the browser.
 *
 * @returns The zone.
 */
export function browserTimeZone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isTimeZone(zone) ? zone : null;
}
