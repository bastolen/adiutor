/**
 * @file Tests for the browser tab icon made from the brand: its version
 * changes exactly when its look does, it's drawn at both sizes from initials
 * or an image, and it's wrapped as an `.ico` holding the PNG.
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { derivePalette, imageFacts, NO_BRAND_COLOURS } from '@/lib/branding';

import { drawBrandIcon, icoOf, planBrandIcon } from './brand-icon';

// What loads the brand reads the database; these tests draw from what they're given.
vi.mock('../people/staff-name', () => ({ default: vi.fn() }));
vi.mock('./brand-images', () => ({ loadBrandImage: vi.fn(), loadBrandImages: vi.fn() }));
vi.mock('./colours', () => ({ default: vi.fn() }));

/** Adiutor's own colours, worked out. */
const ADIUTOR_PALETTE = derivePalette(NO_BRAND_COLOURS);

/** A palette with a pink accent. */
const PINK_PALETTE = derivePalette({ accent: '#c2185b', accentDark: null, tint: null });

/** A wordmark that was uploaded. */
const WIDE_LOGO = { id: 'logo-1', width: 280, height: 64 };

/** A square logo that was uploaded. */
const SQUARE_LOGO = { id: 'logo-2', width: 256, height: 256 };

/** Adiutor's own logo as a PNG, 280 by 64 pixels. */
const LOGO_PNG = { content: new Uint8Array(readFileSync('public/brand/logo.png')), ...WIDE_LOGO };

describe('planBrandIcon', () => {
  it('plans nothing, Adiutor’s own icon, without an upload', () => {
    expect(planBrandIcon({}, 'Acme Support', ADIUTOR_PALETTE)).toBeNull();
  });

  it('draws the initials of a wide logo’s staff on the light accent', () => {
    expect(planBrandIcon({ logo: WIDE_LOGO }, 'Acme Support', ADIUTOR_PALETTE)).toMatchObject({
      source: { kind: 'initials', letters: 'AS' },
      imageId: null,
      colours: {
        background: ADIUTOR_PALETTE.palette.light.primary,
        text: ADIUTOR_PALETTE.palette.light['primary-foreground'],
      },
    });
  });

  it('gives initials a new version with a new name or accent, and the same one otherwise', () => {
    /**
     * The version of a wide logo's icon.
     *
     * @param name - The staff's name.
     * @param palette - The brand's palette.
     * @returns The version.
     */
    const version = (name: string, palette = ADIUTOR_PALETTE) =>
      planBrandIcon({ logo: WIDE_LOGO }, name, palette)?.version;

    expect(version('Acme Support')).toBe(version('Acme Support'));
    expect(version('Acme Support')).not.toBe(version('Beta Support'));
    expect(version('Acme Support')).not.toBe(version('Acme Support', PINK_PALETTE));
    // The same initials look the same.
    expect(version('Acme Support')).toBe(version('Alpha Service'));
  });

  it('gives an image’s icon a new version with a new upload only', () => {
    /**
     * The version of an icon drawn from what was uploaded.
     *
     * @param images - The uploaded images.
     * @param name - The staff's name.
     * @returns The version.
     */
    const version = (images: Parameters<typeof planBrandIcon>[0], name = 'Acme Support') =>
      planBrandIcon(images, name, ADIUTOR_PALETTE)?.version;

    expect(version({ logo: SQUARE_LOGO })).toBe(version({ logo: SQUARE_LOGO }, 'Beta Support'));
    expect(version({ logo: SQUARE_LOGO })).not.toBe(
      version({ logo: { ...SQUARE_LOGO, id: 'logo-3' } }),
    );
    const icon = { id: 'icon-1', width: 64, height: 64 };
    expect(planBrandIcon({ logo: WIDE_LOGO, icon }, 'Acme', ADIUTOR_PALETTE)).toMatchObject({
      source: { kind: 'icon' },
      imageId: 'icon-1',
    });
  });
});

describe('drawBrandIcon', () => {
  it('draws initials and images at a browser tab’s size and an Apple touch icon’s', async () => {
    const initials = planBrandIcon({ logo: WIDE_LOGO }, 'Acme Support', ADIUTOR_PALETTE);
    const square = planBrandIcon({ logo: SQUARE_LOGO }, 'Acme Support', ADIUTOR_PALETTE);
    expect(initials && square).toBeTruthy();
    if (!initials || !square) {
      return;
    }

    const drawn = await Promise.all(
      ([32, 180] as const).flatMap((size) => [
        drawBrandIcon(initials, size, null),
        drawBrandIcon(square, size, LOGO_PNG),
      ]),
    );
    expect(drawn.map((png) => imageFacts(png))).toEqual(
      [32, 32, 180, 180].map((size) => ({ type: 'png', width: size, height: size })),
    );
  });
});

describe('icoOf', () => {
  it('wraps a PNG as an .ico holding one 32-bit image of its size', () => {
    const png = new Uint8Array([1, 2, 3, 4, 5]);
    const ico = icoOf(png, 32);

    expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0]);
    expect([...ico.subarray(6, 8)]).toEqual([32, 32]);
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect(view.getUint16(12, true)).toBe(32);
    expect(view.getUint32(14, true)).toBe(5);
    expect(view.getUint32(18, true)).toBe(22);
    expect([...ico.subarray(22)]).toEqual([1, 2, 3, 4, 5]);
  });

  it('writes 0 for an image of 256 pixels', () => {
    expect([...icoOf(new Uint8Array([1]), 256).subarray(6, 8)]).toEqual([0, 0]);
  });
});
