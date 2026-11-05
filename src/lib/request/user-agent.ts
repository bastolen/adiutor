/**
 * @file Turns a browser's user agent into a short description such as
 * "Chrome on macOS", for lists of signed-in devices. Deliberately small: it
 * recognises the common browsers and systems, and says "Unknown" otherwise.
 */

/** A device as shown to people. */
export interface DeviceDescription {
  /** Browser name, e.g. "Firefox". */
  browser: string;
  /** Operating system, e.g. "Windows". */
  os: string;
  /** Both together, e.g. "Firefox on Windows". */
  label: string;
}

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
  const browser = BROWSERS.find(([pattern]) => pattern.test(value))?.[1] ?? 'Unknown browser';
  const os = SYSTEMS.find(([pattern]) => pattern.test(value))?.[1] ?? 'unknown system';
  return { browser, os, label: `${browser} on ${os}` };
}
