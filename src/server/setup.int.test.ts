/**
 * @file Integration tests for first-run setup.
 */
import { verifyPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { account, rateLimitBucket, requestType, setting, user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';
import { LOCALES } from '@/lib/i18n/locales';

import {
  createStaffSettings,
  createUser,
  saveSettings,
  setupTestContext,
  auditEvents,
} from '../../tests/integration/helpers';
import { hitRateLimit } from './rate-limit';
import { addSetting, readSettings } from './settings';
import { isSetUp, isWebSetupOpen, setUpPlatform } from './setup';

const { db } = setupTestContext();

/** Setup input with test data. */
const input = {
  staffName: 'Adiutor Tests',
  name: 'Setup Admin',
  email: 'Setup@Adiutor.test',
  password: 'setup-password-1',
};

describe('setUpPlatform', () => {
  it('names the staff and makes the first Admin', async () => {
    expect(await isSetUp(db)).toBe(false);

    const result = await setUpPlatform({ db }, input);
    expect(result).toMatchObject({ email: 'setup@adiutor.test', createdUser: true });
    expect(await isSetUp(db)).toBe(true);
    expect(await readSettings(db, ['staff.name', 'staff.offered_locales'])).toEqual({
      'staff.name': 'Adiutor Tests',
      'staff.offered_locales': [...LOCALES],
    });
    // Every language there is now is stored, so one added later starts off.
    const stored = await db.select({ key: setting.key }).from(setting).orderBy(setting.key);
    expect(stored.map(({ key }) => key)).toEqual([
      'setup.completed_at',
      'staff.default_locale',
      'staff.default_time_zone',
      'staff.name',
      'staff.offered_locales',
    ]);

    const admin = firstRow(
      await db.select().from(user).where(eq(user.id, result.userId)),
      'the first Admin',
    );
    expect(admin).toMatchObject({
      name: 'Setup Admin',
      email: 'setup@adiutor.test',
      platformRole: 'platform_admin',
    });

    const credential = firstRow(
      await db.select().from(account).where(eq(account.userId, admin.id)),
      'the password account',
    );
    expect(
      await verifyPassword({
        hash: defined(credential.password, 'the password hash'),
        password: input.password,
      }),
    ).toBe(true);
  });

  it('records the new Admin’s account, by and about them', async () => {
    const { userId } = await setUpPlatform({ db }, input);

    expect(
      await auditEvents(db, { fields: ['action', 'actorUserId', 'targetUserId', 'details'] }),
    ).toEqual([
      {
        action: 'account_created',
        actorUserId: userId,
        targetUserId: userId,
        details: { email: 'setup@adiutor.test', setup: true },
      },
    ]);
  });

  it("lifts a pause on password sign-in for the new Admin's address, whose password was just chosen", async () => {
    const failed = { limit: 10, windowSeconds: 15 * 60 };
    await hitRateLimit({ db }, 'sign-in-failed:email:setup@adiutor.test', failed);

    await setUpPlatform({ db }, input);

    expect(await db.select().from(rateLimitBucket)).toEqual([]);
  });

  it('is refused once set up', async () => {
    await setUpPlatform({ db }, input);
    await expect(
      setUpPlatform({ db }, { ...input, email: 'other@adiutor.test' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('lets only one of two simultaneous setups succeed', async () => {
    const results = await Promise.allSettled([
      setUpPlatform({ db }, input),
      setUpPlatform({ db }, { ...input, email: 'other@adiutor.test' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'conflict' });
    expect(
      await db.select().from(setting).where(eq(setting.key, 'setup.completed_at')),
    ).toHaveLength(1);
  });

  it('refuses marking it set up twice in the database itself', async () => {
    await db.transaction((tx) => addSetting(tx, 'setup.completed_at', new Date()));
    await expect(
      db.transaction((tx) => addSetting(tx, 'setup.completed_at', new Date())),
    ).rejects.toMatchObject({ cause: { code: '23505', constraint: 'setting_key_idx' } });
  });

  it('counts as done only once setup marked it, whatever settings are saved', async () => {
    await saveSettings(db, { 'staff.name': 'Adiutor Tests', 'requests.prefix': 'AT' });
    expect(await isSetUp(db)).toBe(false);
    expect(await isWebSetupOpen(db)).toBe(true);
  });

  it('uses an existing account without changing its password, making it an Admin', async () => {
    const userId = await createUser(db, 'setup@adiutor.test');
    const result = await setUpPlatform({ db }, input, { allowExistingAccount: true });
    expect(result).toMatchObject({ userId, createdUser: false });
    expect(await db.select().from(account).where(eq(account.userId, userId))).toHaveLength(0);
    const found = firstRow(await db.select().from(user).where(eq(user.id, userId)), 'the user');
    expect(found.platformRole).toBe('platform_admin');
  });

  it('creates an email-link account when no password is given', async () => {
    const { userId } = await setUpPlatform({ db }, { ...input, password: undefined });
    expect(await db.select().from(account).where(eq(account.userId, userId))).toHaveLength(0);
  });

  it("sets Adiutor's default language, English (US) unless chosen", async () => {
    await setUpPlatform({ db }, input);

    expect(await readSettings(db, ['staff.default_locale'])).toEqual({
      'staff.default_locale': 'en-US',
    });
  });

  it("keeps the Admin in the language they set up in, whatever Adiutor's default", async () => {
    const { userId } = await setUpPlatform(
      { db },
      {
        ...input,
        defaultLocale: 'nl-NL',
        adminLocale: 'es-ES',
      },
    );

    expect(await readSettings(db, ['staff.default_locale'])).toEqual({
      'staff.default_locale': 'nl-NL',
    });
    const admin = firstRow(await db.select().from(user).where(eq(user.id, userId)), 'the Admin');
    expect(admin.locale).toBe('es-ES');
  });

  it('names the built-in request types in the language it’s set up in', async () => {
    await db
      .update(requestType)
      .set({ name: 'Changed', updatedAt: new Date() })
      .where(eq(requestType.key, 'support'));

    await setUpPlatform({ db }, { ...input, defaultLocale: 'nl-NL' });

    const names = await db
      .select({ key: requestType.key, name: requestType.name })
      .from(requestType)
      .orderBy(requestType.position);
    expect(names).toEqual([
      { key: 'hotfix', name: 'Hotfix' },
      { key: 'bug', name: 'Bug' },
      // One the staff changed already keeps its name.
      { key: 'support', name: 'Changed' },
      { key: 'new_feature', name: 'Nieuwe functie' },
    ]);
  });

  it('starts the Admin on Default when they set up in the default language they chose', async () => {
    const { userId } = await setUpPlatform(
      { db },
      {
        ...input,
        defaultLocale: 'nl-NL',
        adminLocale: 'nl-NL',
      },
    );

    const admin = firstRow(await db.select().from(user).where(eq(user.id, userId)), 'the Admin');
    expect(admin.locale).toBeNull();
  });

  it("takes the browser's zone as Adiutor's default zone and the new Admin's own", async () => {
    const { userId } = await setUpPlatform({ db }, { ...input, timeZone: 'Europe/Amsterdam' });

    expect(await readSettings(db, ['staff.default_time_zone'])).toEqual({
      'staff.default_time_zone': 'Europe/Amsterdam',
    });
    const admin = firstRow(await db.select().from(user).where(eq(user.id, userId)), 'the Admin');
    expect(admin.timeZone).toBe('Europe/Amsterdam');
  });

  it.each([undefined, '', 'Mars/Olympus_Mons'])(
    'starts in UTC with the zone %j, leaving the Admin’s to their first visit',
    async (timeZone) => {
      const { userId } = await setUpPlatform({ db }, { ...input, timeZone });

      expect(await readSettings(db, ['staff.default_time_zone'])).toEqual({
        'staff.default_time_zone': 'UTC',
      });
      const admin = firstRow(await db.select().from(user).where(eq(user.id, userId)), 'the Admin');
      expect(admin.timeZone).toBeNull();
    },
  );

  it('keeps the zone of an existing account it makes the Admin', async () => {
    const userId = await createUser(db, 'setup@adiutor.test');
    await db.update(user).set({ timeZone: 'Asia/Tokyo' }).where(eq(user.id, userId));

    await setUpPlatform(
      { db },
      { ...input, timeZone: 'Europe/Amsterdam' },
      { allowExistingAccount: true },
    );

    const admin = firstRow(await db.select().from(user).where(eq(user.id, userId)), 'the Admin');
    expect(admin.timeZone).toBe('Asia/Tokyo');
  });

  it('refuses a default language it doesn’t know, and sets nothing up', async () => {
    await expect(setUpPlatform({ db }, { ...input, defaultLocale: 'fr-FR' })).rejects.toThrow(
      'validation.locale',
    );
    expect(await isSetUp(db)).toBe(false);
    expect(await db.$count(setting)).toBe(0);
  });
});

describe('the web setup form', () => {
  it('is open on a fresh install only', async () => {
    expect(await isWebSetupOpen(db)).toBe(true);
    await createUser(db, 'watcher@adiutor.test');
    // E.g. `setup.completed_at` was lost: nothing is set up, but accounts exist.
    expect(await isSetUp(db)).toBe(false);
    expect(await isWebSetupOpen(db)).toBe(false);
  });

  it('is closed once set up', async () => {
    await createStaffSettings(db);
    expect(await isWebSetupOpen(db)).toBe(false);
  });

  it('never makes an existing account the Admin, and changes nothing', async () => {
    const userId = await createUser(db, 'setup@adiutor.test');

    await expect(setUpPlatform({ db }, input)).rejects.toMatchObject({
      code: 'conflict',
      key: 'errors.setup.alreadySetUp',
    });

    expect(await isSetUp(db)).toBe(false);
    const found = firstRow(await db.select().from(user).where(eq(user.id, userId)), 'the user');
    expect(found.platformRole).toBeNull();
  });

  it('is refused once any account exists, even for a new address', async () => {
    await createUser(db, 'watcher@adiutor.test');
    await expect(setUpPlatform({ db }, input)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(await db.select().from(user).where(eq(user.email, 'setup@adiutor.test'))).toEqual([]);
  });

  it('sets up a fresh install', async () => {
    const result = await setUpPlatform({ db }, input);
    expect(result).toMatchObject({ email: 'setup@adiutor.test', createdUser: true });
    expect(await isWebSetupOpen(db)).toBe(false);
  });
});

describe('the command line', () => {
  it('records making an existing account the Admin, with no acting user', async () => {
    const userId = await createUser(db, 'setup@adiutor.test');
    await setUpPlatform({ db }, input, { allowExistingAccount: true });

    expect(
      await auditEvents(db, { fields: ['action', 'actorUserId', 'targetUserId', 'details'] }),
    ).toEqual([
      {
        action: 'member_added',
        actorUserId: null,
        targetUserId: userId,
        details: {
          staff: true,
          from: null,
          to: 'platform_admin',
          role: 'platform_admin',
          setup: true,
        },
      },
    ]);
  });

  it('recovers a lost setup while accounts exist', async () => {
    await createUser(db, 'watcher@adiutor.test');
    const result = await setUpPlatform(
      { db },
      { ...input, email: 'owner@adiutor.test' },
      { allowExistingAccount: true },
    );
    expect(result.createdUser).toBe(true);
    expect(await isSetUp(db)).toBe(true);
  });

  it('refuses a deactivated account, and changes nothing', async () => {
    const userId = await createUser(db, 'setup@adiutor.test');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, userId));

    await expect(
      setUpPlatform({ db }, input, { allowExistingAccount: true }),
    ).rejects.toMatchObject({
      code: 'conflict',
      key: 'errors.setup.accountDeactivated',
    });
    expect(await isSetUp(db)).toBe(false);
    const found = firstRow(await db.select().from(user).where(eq(user.id, userId)), 'the user');
    expect(found.platformRole).toBeNull();
  });
});
