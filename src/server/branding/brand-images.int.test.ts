/**
 * @file Integration tests for the brand's images against the test database:
 * uploading a logo or an own icon stores the PNG Adiutor drew from it under
 * a new ID, the files and shapes it refuses, removing them, the audit
 * events, and who may change them.
 */
import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { imageFacts } from '@/lib/branding';

import { auditEvents, setupTestContext, staffActor } from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { loadBrandImage, loadBrandImages, removeBrandImage, setBrandImage } from './brand-images';
import { drawPng } from './draw-image';

const { ctx, db } = setupTestContext();

/** Adiutor's own logo as a PNG, 280 by 64 pixels. */
const LOGO_PNG = new Uint8Array(readFileSync('public/brand/logo.png'));

/** The same logo as a JPEG. */
const LOGO_JPEG = new Uint8Array(readFileSync('tests/fixtures/logo.jpg'));

/**
 * A square PNG of one colour.
 *
 * @param side - Its width and height.
 * @returns The PNG.
 */
function squarePng(side: number): Promise<Uint8Array> {
  return drawPng(
    createElement('div', {
      style: { display: 'flex', width: '100%', height: '100%', background: '#0f766e' },
    }),
    { width: side, height: side },
  );
}

/** A staff Admin, recreated before each test. */
let admin: Actor;

beforeEach(async () => {
  admin = await staffActor(db, 'platform_admin', 'admin@adiutor.test');
});

describe('setBrandImage', () => {
  it('stores the logo as a PNG, for pages, emails and its address to read', async () => {
    const stored = await setBrandImage(ctx, admin, 'logo', LOGO_PNG);

    expect(stored).toEqual({ id: expect.any(String), width: 280, height: 64 });
    expect(await loadBrandImages(db)).toEqual({ logo: stored });
    const image = await loadBrandImage(db, 'logo');
    expect(image).toMatchObject(stored);
    expect(image && imageFacts(image.content)).toEqual({ type: 'png', width: 280, height: 64 });
  });

  it('stores a JPEG as a PNG too', async () => {
    await setBrandImage(ctx, admin, 'logo', LOGO_JPEG);

    const image = await loadBrandImage(db, 'logo');
    expect(image && imageFacts(image.content)).toEqual({ type: 'png', width: 280, height: 64 });
  });

  it('shrinks a large icon to the box it’s kept in', async () => {
    expect(await setBrandImage(ctx, admin, 'icon', await squarePng(1000))).toMatchObject({
      width: 512,
      height: 512,
    });
  });

  it('replaces the image before under a new ID, keeping the other kind', async () => {
    const icon = await setBrandImage(ctx, admin, 'icon', await squarePng(64));
    const first = await setBrandImage(ctx, admin, 'logo', LOGO_PNG);
    expect((await loadBrandImage(db, 'logo'))?.id).toBe(first.id);
    const second = await setBrandImage(ctx, admin, 'logo', LOGO_JPEG);

    expect(second.id).not.toBe(first.id);
    expect(await loadBrandImages(db)).toEqual({ logo: second, icon });
    // The bytes served follow the new upload, though the first one's were kept.
    expect((await loadBrandImage(db, 'logo'))?.id).toBe(second.id);
  });

  it('records each upload in the audit log', async () => {
    await setBrandImage(ctx, admin, 'logo', LOGO_PNG);
    await setBrandImage(ctx, admin, 'icon', await squarePng(64));

    expect(await auditEvents(db, { action: 'brand_logo_changed' })).toEqual([
      expect.objectContaining({
        actorUserId: admin.id,
        details: { staff: true, width: 280, height: 64 },
      }),
    ]);
    expect(await auditEvents(db, { action: 'brand_icon_changed' })).toHaveLength(1);
  });

  it.each([
    ['an empty file', () => new Uint8Array(), 'errors.branding.empty'],
    ['a file over 1 MB', () => new Uint8Array(1024 * 1024 + 1), 'errors.branding.tooLarge'],
    [
      'an SVG',
      () => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      'errors.branding.typeNotAllowed',
    ],
    [
      'a PNG that doesn’t decode',
      () => new Uint8Array([...LOGO_PNG.subarray(0, 40), ...new Uint8Array(400).fill(7)]),
      'errors.branding.unreadable',
    ],
  ])('refuses %s, storing nothing', async (_, bytes, message) => {
    await expect(setBrandImage(ctx, admin, 'logo', bytes())).rejects.toMatchObject({
      code: 'invalid',
      message,
    });
    expect(await loadBrandImages(db)).toEqual({});
    expect(await auditEvents(db, { action: 'brand_logo_changed' })).toEqual([]);
  });

  it('refuses a logo or an icon whose shape doesn’t fit', async () => {
    await expect(setBrandImage(ctx, admin, 'icon', LOGO_PNG)).rejects.toMatchObject({
      message: 'errors.branding.iconShape',
    });
    await expect(setBrandImage(ctx, admin, 'logo', await squarePng(24))).rejects.toMatchObject({
      message: 'errors.branding.logoTooSmall',
    });
    expect(await loadBrandImages(db)).toEqual({});
  });

  it('refuses everyone but staff Admins', async () => {
    const manager = await staffActor(db, 'manager', 'manager@adiutor.test');

    await expect(setBrandImage(ctx, manager, 'logo', LOGO_PNG)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await loadBrandImages(db)).toEqual({});
  });

  it('changes nothing while a staff member is signed in as someone', async () => {
    const signedInAs = {
      ...admin,
      signedInAs: {
        staffId: admin.id,
        staffName: 'Sam Lee',
        endsAt: new Date(Date.now() + 30 * 60_000),
        returnTo: '/dashboard',
        staffPermissions: [],
      },
    };
    await setBrandImage(ctx, admin, 'logo', LOGO_PNG);

    await expect(setBrandImage(ctx, signedInAs, 'icon', LOGO_PNG)).rejects.toMatchObject({
      code: 'signed_in_as',
    });
    await expect(removeBrandImage(ctx, signedInAs, 'logo')).rejects.toMatchObject({
      code: 'signed_in_as',
    });
    expect(Object.keys(await loadBrandImages(db))).toEqual(['logo']);
  });
});

describe('removeBrandImage', () => {
  it('removes the image and records it, once', async () => {
    await setBrandImage(ctx, admin, 'logo', LOGO_PNG);

    expect(await removeBrandImage(ctx, admin, 'logo')).toBe(true);
    expect(await removeBrandImage(ctx, admin, 'logo')).toBe(false);

    expect(await loadBrandImages(db)).toEqual({});
    expect(await loadBrandImage(db, 'logo')).toBeNull();
    expect(await auditEvents(db, { action: 'brand_logo_removed' })).toHaveLength(1);
  });
});
