/**
 * @file Integration tests for the browser tab icon and the page's images,
 * against the test database: Adiutor's own until something is uploaded, the
 * staff's initials for a wide logo, a new version (and drawing) when the
 * name changes and none otherwise, the logo's address for pages, and what
 * the General tab shows of them.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it } from 'vitest';

import { imageFacts } from '@/lib/branding';

import { saveSettings, setupTestContext, staffActor } from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { loadBrandIcon } from './brand-icon';
import { setBrandImage } from './brand-images';
import getBrandImageSettings from './image-settings';
import requestBrandImages, { pageIcons } from './page-images';

const { ctx, db } = setupTestContext();

/** Adiutor's own logo as a PNG, 280 by 64 pixels: a wordmark. */
const LOGO_PNG = new Uint8Array(readFileSync('public/brand/logo.png'));

/** A staff Admin, recreated before each test. */
let admin: Actor;

beforeEach(async () => {
  admin = await staffActor(db, 'platform_admin', 'admin@adiutor.test');
});

describe('loadBrandIcon', () => {
  it('gives nothing, Adiutor’s own icon, until a logo or an icon is uploaded', async () => {
    expect(await loadBrandIcon(db, 32)).toBeNull();
  });

  it('draws the icon once per version, and again once the staff’s name changes', async () => {
    await saveSettings(db, { 'staff.name': 'Adiutor Tests Support' });
    await setBrandImage(ctx, admin, 'logo', LOGO_PNG);

    const first = await loadBrandIcon(db, 32);
    expect(first && imageFacts(first.png)).toEqual({ type: 'png', width: 32, height: 32 });
    // The same brand: the icon drawn before.
    expect((await loadBrandIcon(db, 32))?.png).toBe(first?.png);

    await saveSettings(db, { 'staff.name': 'Beta Tests' });
    const renamed = await loadBrandIcon(db, 32);
    expect(renamed?.version).not.toBe(first?.version);
    expect(renamed?.png).not.toEqual(first?.png);
  });

  it('draws once for requests that come together', async () => {
    await saveSettings(db, { 'staff.name': 'Adiutor Tests Together' });
    await setBrandImage(ctx, admin, 'logo', LOGO_PNG);

    const [first, second] = await Promise.all([loadBrandIcon(db, 32), loadBrandIcon(db, 32)]);
    expect(first?.png).toBeDefined();
    expect(second?.png).toBe(first?.png);
  });

  it('draws an Apple touch icon at its own size', async () => {
    await setBrandImage(ctx, admin, 'logo', LOGO_PNG);

    const touch = await loadBrandIcon(db, 180);
    expect(touch && imageFacts(touch.png)).toEqual({ type: 'png', width: 180, height: 180 });
  });
});

describe('requestBrandImages', () => {
  it('gives Adiutor’s logo and icon until something is uploaded', async () => {
    expect(await requestBrandImages()).toEqual({ logo: null, iconVersion: null });
  });

  it('gives the logo’s address and size, and the icon’s version, after an upload', async () => {
    const logo = await setBrandImage(ctx, admin, 'logo', LOGO_PNG);
    const icon = await loadBrandIcon(db, 32);

    expect(await requestBrandImages()).toEqual({
      logo: { src: `/branding/logo?v=${logo.id}`, width: 280, height: 64 },
      iconVersion: icon?.version,
    });
  });
});

describe('getBrandImageSettings', () => {
  it('gives no logo and Adiutor’s icon until something is uploaded', async () => {
    expect(await getBrandImageSettings(ctx, admin)).toEqual({
      logo: null,
      ownIcon: false,
      icon: null,
    });
  });

  it('gives the logo, whether there’s an own icon, and what the icon is drawn from', async () => {
    const logo = await setBrandImage(ctx, admin, 'logo', LOGO_PNG);

    const settings = await getBrandImageSettings(ctx, admin);
    expect(settings).toEqual({
      logo: { src: `/branding/logo?v=${logo.id}`, width: 280, height: 64 },
      ownIcon: false,
      icon: { version: expect.any(String), source: 'initials' },
    });
    expect(settings.icon?.version).toBe((await loadBrandIcon(db, 32))?.version);
  });

  it('refuses everyone but staff Admins', async () => {
    const support = await staffActor(db, 'support', 'support@adiutor.test');

    await expect(getBrandImageSettings(ctx, support)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('pageIcons', () => {
  it('links Adiutor’s own icons without a version', () => {
    expect(pageIcons(null)).toEqual({
      icon: [
        { url: '/brand/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
        { url: '/brand/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    });
  });

  it('links the brand’s icon and its Apple touch icon with their version', () => {
    expect(pageIcons('abc')).toEqual({
      icon: [{ url: '/branding/icon?v=abc', sizes: '32x32', type: 'image/png' }],
      apple: [{ url: '/branding/icon?size=180&v=abc', sizes: '180x180', type: 'image/png' }],
    });
  });
});
