/**
 * @file Integration tests for saving the signed-in user's own language.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import { createUser, setupTestContext, staffActor } from '../../../tests/integration/helpers';
import { loadActor } from '../actor';
import setOwnLocale from './own-locale';

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
    const actor = defined(await loadActor(db, jane), 'the actor');

    await expect(setOwnLocale(ctx, actor, 'es-ES')).resolves.toBe('es-ES');

    expect(await savedLocale(jane)).toBe('es-ES');
    expect(await savedLocale(sam)).toBeNull();
  });

  it('refuses anything but one of the languages', async () => {
    const admin = await staffActor(db, 'platform_admin');

    await expect(setOwnLocale(ctx, admin, 'fr-FR')).rejects.toThrow(ZodError);
    await expect(setOwnLocale(ctx, admin, 'fr-FR')).rejects.toThrow('Choose one of the languages.');
    expect(await savedLocale(admin.id)).toBeNull();
  });
});
