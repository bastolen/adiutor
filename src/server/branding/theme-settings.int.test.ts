/**
 * @file Integration tests for the mode a staff Admin keeps Adiutor in,
 * against the test database: both modes keep no setting, one mode is kept
 * and read for every page, the audit event, the choices it refuses, and who
 * may change it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { auditEvents, setupTestContext, staffActor } from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { readSettings } from '../settings';
import requestForcedTheme from './page-theme';
import { getForcedTheme, loadForcedTheme, setForcedTheme } from './theme-settings';

const { ctx, db } = setupTestContext();

/** A staff Admin, recreated before each test. */
let admin: Actor;

beforeEach(async () => {
  admin = await staffActor(db, 'platform_admin', 'admin@adiutor.test');
});

describe('setForcedTheme', () => {
  it('keeps every page in one mode, for pages to read', async () => {
    expect(await setForcedTheme(ctx, admin, 'dark')).toBe('dark');

    expect(await getForcedTheme(ctx, admin)).toBe('dark');
    expect(await loadForcedTheme(db)).toBe('dark');
    expect(await requestForcedTheme()).toBe('dark');
  });

  it('keeps no setting for both modes, so each person chooses again', async () => {
    await setForcedTheme(ctx, admin, 'light');
    expect(await setForcedTheme(ctx, admin, 'both')).toBeNull();

    expect(await loadForcedTheme(db)).toBeNull();
    expect(await readSettings(db, ['brand.forced_theme'])).toEqual({ 'brand.forced_theme': null });
  });

  it('records each change in the audit log, with the mode it replaced', async () => {
    await setForcedTheme(ctx, admin, 'light');
    await setForcedTheme(ctx, admin, 'both');

    const events = await auditEvents(db, { action: 'brand_theme_changed' });
    expect(events.map(({ details }) => details)).toEqual(
      expect.arrayContaining([
        { staff: true, from: null, to: 'light' },
        { staff: true, from: 'light', to: null },
      ]),
    );
  });

  it.each(['system', '', 'Dark', null])('refuses %j, keeping nothing', async (choice) => {
    await expect(setForcedTheme(ctx, admin, choice)).rejects.toThrow(ZodError);
    await expect(setForcedTheme(ctx, admin, choice)).rejects.toThrow('validation.themeMode');
    expect(await loadForcedTheme(db)).toBeNull();
    expect(await auditEvents(db, { action: 'brand_theme_changed' })).toEqual([]);
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

    await expect(setForcedTheme(ctx, signedInAs, 'dark')).rejects.toMatchObject({
      code: 'signed_in_as',
    });
    expect(await loadForcedTheme(db)).toBeNull();
  });

  it('refuses everyone but staff Admins', async () => {
    const manager = await staffActor(db, 'manager', 'manager@adiutor.test');

    await expect(setForcedTheme(ctx, manager, 'dark')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(getForcedTheme(ctx, manager)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
