/**
 * @file Integration tests for first-run setup.
 */
import { verifyPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { account, auditEvent, rateLimitBucket, staffSettings, user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import { hitRateLimit } from './rate-limit';
import { isSetUp, isWebSetupOpen, setUpPlatform } from './setup';
import { createUser, setupTestContext } from '../../tests/integration/helpers';

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

    const result = await setUpPlatform(db, input);
    expect(result).toMatchObject({ email: 'setup@adiutor.test', createdUser: true });
    expect(await isSetUp(db)).toBe(true);
    expect(await db.select({ name: staffSettings.name }).from(staffSettings)).toEqual([
      { name: 'Adiutor Tests' },
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

  it("lifts a pause on password sign-in for the new Admin's address, whose password was just chosen", async () => {
    const failed = { limit: 10, windowSeconds: 15 * 60 };
    await hitRateLimit({ db }, 'sign-in-failed:email:setup@adiutor.test', failed);

    await setUpPlatform(db, input);

    expect(await db.select().from(rateLimitBucket)).toEqual([]);
  });

  it('is refused once set up', async () => {
    await setUpPlatform(db, input);
    await expect(
      setUpPlatform(db, { ...input, email: 'other@adiutor.test' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('lets only one of two simultaneous setups succeed', async () => {
    const results = await Promise.allSettled([
      setUpPlatform(db, input),
      setUpPlatform(db, { ...input, email: 'other@adiutor.test' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'conflict' });
    expect(await db.select().from(staffSettings)).toHaveLength(1);
  });

  it('refuses a second settings row in the database itself', async () => {
    await db.insert(staffSettings).values({ name: 'Adiutor Tests' });
    await expect(db.insert(staffSettings).values({ name: 'Adiutor Tests Two' })).rejects.toThrow();
  });

  it('uses an existing account without changing its password, making it an Admin', async () => {
    const userId = await createUser(db, 'setup@adiutor.test');
    const result = await setUpPlatform(db, input, { allowExistingAccount: true });
    expect(result).toMatchObject({ userId, createdUser: false });
    expect(await db.select().from(account).where(eq(account.userId, userId))).toHaveLength(0);
    const found = firstRow(await db.select().from(user).where(eq(user.id, userId)), 'the user');
    expect(found.platformRole).toBe('platform_admin');
  });

  it('creates an email-link account when no password is given', async () => {
    const { userId } = await setUpPlatform(db, { ...input, password: undefined });
    expect(await db.select().from(account).where(eq(account.userId, userId))).toHaveLength(0);
  });

  it("sets Adiutor's default language, English (US) unless chosen", async () => {
    await setUpPlatform(db, input);

    expect(
      await db.select({ defaultLocale: staffSettings.defaultLocale }).from(staffSettings),
    ).toEqual([{ defaultLocale: 'en-US' }]);
  });

  it("keeps the Admin in the language they set up in, whatever Adiutor's default", async () => {
    const { userId } = await setUpPlatform(db, {
      ...input,
      defaultLocale: 'nl-NL',
      adminLocale: 'es-ES',
    });

    expect(
      await db.select({ defaultLocale: staffSettings.defaultLocale }).from(staffSettings),
    ).toEqual([{ defaultLocale: 'nl-NL' }]);
    const admin = firstRow(await db.select().from(user).where(eq(user.id, userId)), 'the Admin');
    expect(admin.locale).toBe('es-ES');
  });

  it('refuses a default language it doesn’t know, and sets nothing up', async () => {
    await expect(setUpPlatform(db, { ...input, defaultLocale: 'fr-FR' })).rejects.toThrow(
      'validation.locale',
    );
    expect(await isSetUp(db)).toBe(false);
  });
});

describe('the web setup form', () => {
  it('is open on a fresh install only', async () => {
    expect(await isWebSetupOpen(db)).toBe(true);
    await createUser(db, 'watcher@adiutor.test');
    // E.g. the settings row was lost: nothing is set up, but accounts exist.
    expect(await isSetUp(db)).toBe(false);
    expect(await isWebSetupOpen(db)).toBe(false);
  });

  it('is closed once set up', async () => {
    await db.insert(staffSettings).values({ name: 'Adiutor Tests' });
    expect(await isWebSetupOpen(db)).toBe(false);
  });

  it('never makes an existing account the Admin, and changes nothing', async () => {
    const userId = await createUser(db, 'setup@adiutor.test');

    await expect(setUpPlatform(db, input)).rejects.toMatchObject({
      code: 'conflict',
      key: 'errors.setup.alreadySetUp',
    });

    expect(await isSetUp(db)).toBe(false);
    const found = firstRow(await db.select().from(user).where(eq(user.id, userId)), 'the user');
    expect(found.platformRole).toBeNull();
  });

  it('is refused once any account exists, even for a new address', async () => {
    await createUser(db, 'watcher@adiutor.test');
    await expect(setUpPlatform(db, input)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(await db.select().from(user).where(eq(user.email, 'setup@adiutor.test'))).toEqual([]);
  });

  it('sets up a fresh install', async () => {
    const result = await setUpPlatform(db, input);
    expect(result).toMatchObject({ email: 'setup@adiutor.test', createdUser: true });
    expect(await isWebSetupOpen(db)).toBe(false);
  });
});

describe('the command line', () => {
  it('records making an existing account the Admin, with no acting user', async () => {
    const userId = await createUser(db, 'setup@adiutor.test');
    await setUpPlatform(db, input, { allowExistingAccount: true });

    expect(
      await db
        .select({
          action: auditEvent.action,
          actorUserId: auditEvent.actorUserId,
          targetUserId: auditEvent.targetUserId,
          details: auditEvent.details,
        })
        .from(auditEvent),
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

  it('recovers a lost settings row while accounts exist', async () => {
    await createUser(db, 'watcher@adiutor.test');
    const result = await setUpPlatform(
      db,
      { ...input, email: 'owner@adiutor.test' },
      { allowExistingAccount: true },
    );
    expect(result.createdUser).toBe(true);
    expect(await isSetUp(db)).toBe(true);
  });

  it('refuses a deactivated account, and changes nothing', async () => {
    const userId = await createUser(db, 'setup@adiutor.test');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, userId));

    await expect(setUpPlatform(db, input, { allowExistingAccount: true })).rejects.toMatchObject({
      code: 'conflict',
      key: 'errors.setup.accountDeactivated',
    });
    expect(await isSetUp(db)).toBe(false);
    const found = firstRow(await db.select().from(user).where(eq(user.id, userId)), 'the user');
    expect(found.platformRole).toBeNull();
  });
});
