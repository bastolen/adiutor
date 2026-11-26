/**
 * @file Tests for where the browser tab icon comes from, and the icon size
 * a request asks for.
 */
import { describe, expect, it } from 'vitest';

import { brandIconPath, brandIconSize, brandIconSource, brandLogoPath } from './icon';

/** A wordmark's size. */
const WIDE = { width: 280, height: 64 };

/** A square logo's size. */
const SQUARE = { width: 256, height: 256 };

describe('brandIconSource', () => {
  it('takes the own icon first, whatever the logo', () => {
    expect(brandIconSource({ logo: SQUARE, icon: SQUARE }, 'Acme Support')).toEqual({
      kind: 'icon',
    });
    expect(brandIconSource({ icon: SQUARE }, 'Acme Support')).toEqual({ kind: 'icon' });
  });

  it('takes a logo that is about square as it is', () => {
    expect(brandIconSource({ logo: SQUARE }, 'Acme Support')).toEqual({ kind: 'logo' });
    expect(brandIconSource({ logo: { width: 150, height: 100 } }, 'Acme Support')).toEqual({
      kind: 'logo',
    });
  });

  it('gives the staff’s initials for a wide logo', () => {
    expect(brandIconSource({ logo: WIDE }, 'Acme Support')).toEqual({
      kind: 'initials',
      letters: 'AS',
    });
    expect(brandIconSource({ logo: WIDE }, 'Ångström Hjälp')).toEqual({
      kind: 'initials',
      letters: 'ÅH',
    });
  });

  it('draws the Latin letters the font has, Romanian and Vietnamese ones included', () => {
    expect(brandIconSource({ logo: WIDE }, 'Ștefan Ước')).toEqual({
      kind: 'initials',
      letters: 'ȘƯ',
    });
    expect(brandIconSource({ logo: WIDE }, 'Ạnh Đức')).toEqual({ kind: 'initials', letters: 'ẠĐ' });
  });

  it('takes the logo for a name whose initials the font can’t draw, which would fetch a font', () => {
    expect(brandIconSource({ logo: WIDE }, 'サポート')).toEqual({ kind: 'logo' });
    expect(brandIconSource({ logo: WIDE }, 'Служба поддержки')).toEqual({ kind: 'logo' });
    // Letters of Latin Extended-A the font lacks, first or second.
    expect(brandIconSource({ logo: WIDE }, 'Ŏlga Support')).toEqual({ kind: 'logo' });
    expect(brandIconSource({ logo: WIDE }, 'Acme Ĭnc')).toEqual({ kind: 'logo' });
    expect(brandIconSource({ logo: WIDE }, 'Ǆuro')).toEqual({ kind: 'logo' });
  });

  it('gives nothing, Adiutor’s own icon, without an upload', () => {
    expect(brandIconSource({}, 'Acme Support')).toBeNull();
  });
});

describe('brandIconSize', () => {
  it('gives an Apple touch icon’s size only when asked, a browser tab’s otherwise', () => {
    expect(brandIconSize('180')).toBe(180);
    expect(brandIconSize('32')).toBe(32);
    expect(brandIconSize(null)).toBe(32);
    expect(brandIconSize('4096')).toBe(32);
  });
});

describe('brand image addresses', () => {
  it('carries the version, encoded, and the size only for a touch icon', () => {
    expect(brandLogoPath('0193a/b')).toBe('/branding/logo?v=0193a%2Fb');
    expect(brandIconPath('abc', 32)).toBe('/branding/icon?v=abc');
    expect(brandIconPath('abc', 180)).toBe('/branding/icon?size=180&v=abc');
  });
});
