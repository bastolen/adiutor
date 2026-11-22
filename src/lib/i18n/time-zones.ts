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

/**
 * The areas of the IANA names (the part before the first `/`) that the list
 * groups zones under, in the order it lists them. A zone in any other area
 * (`Etc/…`) is listed under "Other zones", last.
 */
export const TIME_ZONE_REGIONS = [
  'Africa',
  'America',
  'Antarctica',
  'Arctic',
  'Asia',
  'Atlantic',
  'Australia',
  'Europe',
  'Indian',
  'Pacific',
] as const;

/** The group a zone is listed under: one of {@link TIME_ZONE_REGIONS}, or `Other`. */
export type TimeZoneRegion = (typeof TIME_ZONE_REGIONS)[number] | 'Other';

/** One zone to pick from. */
export interface TimeZoneOption {
  /** The zone's name, e.g. `Europe/Amsterdam`: what's saved. */
  value: string;
  /**
   * What the list shows: the place and its offset now, e.g. "Amsterdam
   * (UTC+01:00)", "Buenos Aires, Argentina (UTC−03:00)" for a name in three
   * parts, or only "UTC". A zone in an area Adiutor doesn't group shows its
   * whole name.
   */
  label: string;
  /**
   * The group it's listed under (its heading is `common.timeZoneRegion`), or
   * `null` for UTC, which comes first, under no heading.
   */
  region: TimeZoneRegion | null;
}

/**
 * Whether an area is one the list groups zones under.
 *
 * @param area - The part of a zone's name before the first `/`.
 * @returns Whether it's one of {@link TIME_ZONE_REGIONS}.
 */
function isRegion(area: string): area is (typeof TIME_ZONE_REGIONS)[number] {
  return (TIME_ZONE_REGIONS as readonly string[]).includes(area);
}

/**
 * A zone as the list offers it, with its offset at a moment: its region,
 * and its place written out (`_` as a space, the smallest place first).
 *
 * @param zone - The zone's name, e.g. `America/Argentina/Buenos_Aires`.
 * @param at - The moment the offset is for (now).
 * @returns The option.
 */
export function timeZoneOption(zone: string, at: Date): TimeZoneOption {
  if (zone === DEFAULT_TIME_ZONE) {
    return { value: zone, label: zone, region: null };
  }
  const offset = timeZoneOffset(zone, at);
  const [area = '', ...places] = zone.split('/');
  if (isRegion(area) && places.length > 0) {
    const place = [...places]
      .reverse()
      .map((part) => part.replaceAll('_', ' '))
      .join(', ');
    return { value: zone, label: `${place} (${offset})`, region: area };
  }
  return { value: zone, label: `${zone.replaceAll('_', ' ')} (${offset})`, region: 'Other' };
}

/**
 * Where a zone's group comes in the list: UTC first, then the regions in
 * their order, then the other zones.
 *
 * @param region - The zone's group.
 * @returns Its place.
 */
function regionOrder(region: TimeZoneRegion | null): number {
  if (region === null) {
    return -1;
  }
  return region === 'Other' ? TIME_ZONE_REGIONS.length : TIME_ZONE_REGIONS.indexOf(region);
}

/**
 * The order of the list: by group, then by place (in English, as the names
 * are written), so every option of a group follows the one before it.
 *
 * @param a - One option.
 * @param b - Another.
 * @returns Negative when `a` comes first, positive when `b` does.
 */
export function compareTimeZoneOptions(a: TimeZoneOption, b: TimeZoneOption): number {
  return (
    regionOrder(a.region) - regionOrder(b.region) ||
    a.label.localeCompare(b.label, 'en') ||
    a.value.localeCompare(b.value, 'en')
  );
}

/**
 * Every zone the runtime knows, and `UTC`, each with its offset at a moment,
 * grouped by region and by place within it ({@link compareTimeZoneOptions}).
 * A zone that isn't in the runtime's list (an older name a browser still
 * reports, like `Asia/Calcutta`) is added when it's the one chosen.
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
  return [...zones].map((zone) => timeZoneOption(zone, at)).sort(compareTimeZoneOptions);
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
