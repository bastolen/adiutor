/**
 * @file Turns a browser's user agent into its browser and operating system,
 * for descriptions such as "Chrome on macOS" in lists of signed-in devices
 * (the `common.device` message, which puts them together in the reader's
 * language). Deliberately small: it recognises the common browsers and
 * systems, and says `unknown` otherwise.
 */

/**
 * A device's browser (a name such as "Firefox", never translated) and
 * operating system (e.g. "Windows"), each `unknown` when not recognised, as
 * the `common.device` message takes them: `t('device', describeUserAgent(ua))`.
 * A record rather than an interface, so it fits a message's values.
 */
export type DeviceDescription = Record<'browser' | 'os', string>;

/** Browsers by the token that identifies them, most specific first. */
const BROWSERS: readonly [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

/** Operating systems by the token that identifies them, most specific first. */
const SYSTEMS: readonly [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];

/**
 * Describes a user agent.
 *
 * @param userAgent - The `User-Agent` header, if known.
 * @returns The browser and operating system.
 */
export function describeUserAgent(userAgent: string | null | undefined): DeviceDescription {
  const value = userAgent ?? '';
  const browser = BROWSERS.find(([pattern]) => pattern.test(value))?.[1] ?? 'unknown';
  const os = SYSTEMS.find(([pattern]) => pattern.test(value))?.[1] ?? 'unknown';
  return { browser, os };
}
