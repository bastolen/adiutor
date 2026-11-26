/**
 * @file Integration tests for the brand colours on the Appearance tab of
 * Settings, against the test database: saving and reading them, a dark
 * accent on its own, clearing them back to the theme's, the colours it
 * refuses, the audit event, and who may save them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { NO_BRAND_COLOURS } from '@/lib/branding';

import { auditEvents, setupTestContext, staffActor } from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { getBrandColours, setBrandColours } from './colour-settings';
import loadBrandColours from './colours';

const { ctx, db } = setupTestContext();

/** A staff Admin, recreated before each test. */
let admin: Actor;

beforeEach(async () => {
  admin = await staffActor(db, 'platform_admin', 'admin@adiutor.test');
});

describe('setBrandColours', () => {
  it('saves the colours as # and lower case, for every page and email to read', async () => {
    expect(
      await setBrandColours(ctx, admin, {
        accent: ' C2185B ',
        accentDark: '#FF80AB',
        tint: '2e7d32',
      }),
    ).toEqual({ accent: '#c2185b', accentDark: '#ff80ab', tint: '#2e7d32' });

    expect(await getBrandColours(ctx, admin)).toEqual({
      accent: '#c2185b',
      accentDark: '#ff80ab',
      tint: '#2e7d32',
    });
    expect(await loadBrandColours(db)).toEqual(await getBrandColours(ctx, admin));
  });

  it('goes back to the theme’s colours for empty fields', async () => {
    await setBrandColours(ctx, admin, {
      accent: '#c2185b',
      accentDark: '#ff80ab',
      tint: '#2e7d32',
    });
    await setBrandColours(ctx, admin, { accent: '', accentDark: '', tint: '' });

    expect(await getBrandColours(ctx, admin)).toEqual(NO_BRAND_COLOURS);
  });

  it('saves an accent for dark mode on its own, light mode keeping the theme’s', async () => {
    expect(
      await setBrandColours(ctx, admin, { accent: '', accentDark: '#FF80AB', tint: '' }),
    ).toEqual({ ...NO_BRAND_COLOURS, accentDark: '#ff80ab' });

    expect(await loadBrandColours(db)).toEqual({ ...NO_BRAND_COLOURS, accentDark: '#ff80ab' });
  });

  it('records the change in the audit log, with the colours it replaced', async () => {
    await setBrandColours(ctx, admin, { accent: '#c2185b', accentDark: '', tint: '' });
    await setBrandColours(ctx, admin, { accent: '#c2185b', accentDark: '', tint: '#2e7d32' });

    const events = await auditEvents(db, { action: 'brand_colours_changed' });
    expect(events).toHaveLength(2);
    expect(events.map(({ details }) => details)).toContainEqual(
      expect.objectContaining({
        staff: true,
        from: { accent: '#c2185b', accentDark: null, tint: null },
        to: { accent: '#c2185b', accentDark: null, tint: '#2e7d32' },
      }),
    );
  });

  it.each([
    [{ accent: 'teal', accentDark: '', tint: '' }, 'validation.brandColour.accent'],
    [{ accent: '#c2185b', accentDark: '#ff80a', tint: '' }, 'validation.brandColour.accentDark'],
    [
      { accent: '', accentDark: '', tint: '#2e7d32;}body{color:red' },
      'validation.brandColour.tint',
    ],
  ])('refuses %j, saving nothing', async (input, message) => {
    await expect(setBrandColours(ctx, admin, input)).rejects.toThrow(ZodError);
    await expect(setBrandColours(ctx, admin, input)).rejects.toThrow(message);
    expect(await loadBrandColours(db)).toEqual(NO_BRAND_COLOURS);
    expect(await auditEvents(db, { action: 'brand_colours_changed' })).toEqual([]);
  });

  it('saves nothing while a staff member is signed in as someone', async () => {
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

    await expect(
      setBrandColours(ctx, signedInAs, { accent: '#c2185b', accentDark: '', tint: '' }),
    ).rejects.toMatchObject({ code: 'signed_in_as' });
    expect(await loadBrandColours(db)).toEqual(NO_BRAND_COLOURS);
  });

  it('is for staff Admins only', async () => {
    const manager = await staffActor(db, 'manager', 'manager@adiutor.test');

    await expect(
      setBrandColours(ctx, manager, { accent: '#c2185b', accentDark: '', tint: '' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(getBrandColours(ctx, manager)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
