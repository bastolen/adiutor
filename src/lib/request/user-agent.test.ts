/**
 * @file Tests for describing user agents.
 */
import { describe, expect, it } from 'vitest';

import translator from '@/lib/i18n/translator';

import { describeUserAgent } from './user-agent';

/** The device message in English (US), as the pages show it. */
const t = translator('en-US', 'common');

describe('describeUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Chrome on macOS',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      'Edge on Windows',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0', 'Firefox on Linux'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari on iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
  ])('describes %s', (userAgent, label) => {
    expect(t('device', describeUserAgent(userAgent))).toBe(label);
  });

  it('says unknown without a user agent', () => {
    expect(describeUserAgent(null)).toEqual({ browser: 'unknown', os: 'unknown' });
    expect(t('device', describeUserAgent(null))).toBe('Unknown browser on unknown system');
  });

  it.each([
    ['nl-NL', 'Firefox op Linux', 'Onbekende browser op onbekend systeem'],
    ['es-ES', 'Firefox en Linux', 'Navegador desconocido en sistema desconocido'],
  ] as const)('speaks %s', (locale, known, unknown) => {
    const tIn = translator(locale, 'common');
    expect(tIn('device', describeUserAgent('Mozilla/5.0 (X11; Linux x86_64) Firefox/144.0'))).toBe(
      known,
    );
    expect(tIn('device', describeUserAgent(null))).toBe(unknown);
  });
});
