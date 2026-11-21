/**
 * @file Integration tests for saving the signed-in user's own language.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { user } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import {
  actorFor,
  createStaffSettings,
  createUser,
  setupTestContext,
  setUserLocale,
  staffActor,
} from '../../../tests/integration/helpers';
import setOwnLocale, { ownLanguage } from './own-locale';

const { ctx, db } = setupTestContext();

/**
 * Reads a user's saved language.
 *
 * @param userId - The user.
 * @returns Their `user.locale`.
 */
async function savedLocale(userId: string) {
  return firstRow(
    await db.select({ locale: user.locale }).from(user).where(eq(user.id, userId)),
    'the user',
  ).locale;
}

describe('setOwnLocale', () => {
  it("saves the user's own language, and only theirs", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sam = await createUser(db, 'sam@adiutor.test');
    const actor = await actorFor(db, jane);

    await expect(setOwnLocale(ctx, actor, 'es-ES')).resolves.toBe('es-ES');

    expect(await savedLocale(jane)).toBe('es-ES');
    expect(await savedLocale(sam)).toBeNull();
  });

  it('saves Default as no language, so the account follows Adiutor’s default', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await setUserLocale(db, jane, 'nl-NL');
    const actor = await actorFor(db, jane);

    await expect(setOwnLocale(ctx, actor, 'default')).resolves.toBeNull();

    expect(await savedLocale(jane)).toBeNull();
  });

  it('refuses anything but one of the languages or Default', async () => {
    const admin = await staffActor(db, 'platform_admin');

    await expect(setOwnLocale(ctx, admin, 'fr-FR')).rejects.toThrow(ZodError);
    await expect(setOwnLocale(ctx, admin, 'fr-FR')).rejects.toThrow('validation.locale');
    expect(await savedLocale(admin.id)).toBeNull();
  });

  it('refuses a language that’s turned off, but not Default', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'en-US', ['en-US', 'es-ES']);
    const jane = await createUser(db, 'jane@adiutor.test');
    const actor = await actorFor(db, jane);

    await expect(setOwnLocale(ctx, actor, 'nl-NL')).rejects.toMatchObject({
      code: 'invalid',
      key: 'errors.language.notOffered',
    });
    await expect(setOwnLocale(ctx, actor, 'default')).resolves.toBeNull();
    expect(await savedLocale(jane)).toBeNull();
  });
});

describe('ownLanguage', () => {
  it('gives the saved language, with Adiutor’s default language', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES');
    const jane = await createUser(db, 'jane@adiutor.test');
    await setUserLocale(db, jane, 'nl-NL');
    const actor = await actorFor(db, jane);

    await expect(ownLanguage(ctx, actor)).resolves.toEqual({
      choice: 'nl-NL',
      defaultLocale: 'es-ES',
      notOffered: null,
      offered: ['en-US', 'nl-NL', 'es-ES'],
    });
  });

  it('gives Default for an account without a saved language, and English (US) before setup', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const actor = await actorFor(db, jane);

    await expect(ownLanguage(ctx, actor)).resolves.toEqual({
      choice: 'default',
      defaultLocale: 'en-US',
      notOffered: null,
      offered: ['en-US', 'nl-NL', 'es-ES'],
    });
  });

  it('gives Default for a saved language that’s turned off, and names it', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES', ['en-US', 'es-ES']);
    const jane = await createUser(db, 'jane@adiutor.test');
    await setUserLocale(db, jane, 'nl-NL');
    const actor = await actorFor(db, jane);

    await expect(ownLanguage(ctx, actor)).resolves.toEqual({
      choice: 'default',
      defaultLocale: 'es-ES',
      notOffered: 'nl-NL',
      offered: ['en-US', 'es-ES'],
    });
  });
});
