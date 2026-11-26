/**
 * @file Tests for the logo at the top of an email: Adiutor's, or the one a
 * staff Admin uploaded, fitted to its room.
 */
import { describe, expect, it } from 'vitest';

import { emailLogo } from './email-layout';
import { DEFAULT_EMAIL_COLOURS } from './theme';

/**
 * A brand with a logo of the given size.
 *
 * @param width - The logo's width.
 * @param height - The logo's height.
 * @returns The brand.
 */
function withLogo(width: number, height: number) {
  return {
    colours: DEFAULT_EMAIL_COLOURS,
    name: 'Adiutor Tests',
    logo: { src: '/branding/logo?v=logo-1', width, height },
  };
}

describe('emailLogo', () => {
  it('shows Adiutor’s logo without an uploaded one', () => {
    expect(emailLogo(undefined)).toEqual({ src: '/brand/logo.png', width: 140, height: 32 });
    expect(emailLogo({ colours: DEFAULT_EMAIL_COLOURS, name: 'Adiutor Tests' })).toEqual({
      src: '/brand/logo.png',
      width: 140,
      height: 32,
    });
  });

  it('shows an uploaded logo 32 pixels high', () => {
    expect(emailLogo(withLogo(1024, 256))).toEqual({
      src: '/branding/logo?v=logo-1',
      width: 128,
      height: 32,
    });
    expect(emailLogo(withLogo(64, 128))).toMatchObject({ width: 16, height: 32 });
  });

  it('keeps a wide logo within 200 pixels, lower then', () => {
    expect(emailLogo(withLogo(1024, 128))).toMatchObject({ width: 200, height: 25 });
  });
});
