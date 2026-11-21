/**
 * @file Integration tests for the first visit's time zone: the browser's zone
 * is saved only while the account has none, a zone Adiutor doesn't accept
 * saves nothing, and nothing is saved while a staff member is signed in as
 * the user.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { user } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import { actorFor, createUser, setupTestContext } from '../../../tests/integration/helpers';
import { loadActor } from '../actor';
import saveFirstTimeZone from './own-time-zone';

const { ctx, db } = setupTestContext();

/**
 * Reads a user's saved time zone.
 *
 * @param userId - The user.
 * @returns Their `user.time_zone`.
 */
async function savedTimeZone(userId: string) {
  return firstRow(
    await db.select({ timeZone: user.timeZone }).from(user).where(eq(user.id, userId)),
    'the user',
  ).timeZone;
}

describe('saveFirstTimeZone', () => {
  it("saves the browser's zone for an account without one", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');

    const saved = await saveFirstTimeZone(ctx, await actorFor(db, jane), 'Europe/Amsterdam');

    expect(saved).toBe('Europe/Amsterdam');
    expect(await savedTimeZone(jane)).toBe('Europe/Amsterdam');
    expect((await loadActor(db, jane))?.timeZone).toBe('Europe/Amsterdam');
  });

  it('never overwrites a saved zone, and gives back the saved one', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ timeZone: 'Asia/Kolkata' }).where(eq(user.id, jane));

    const saved = await saveFirstTimeZone(ctx, await actorFor(db, jane), 'Europe/Amsterdam');

    expect(saved).toBe('Asia/Kolkata');
    expect(await savedTimeZone(jane)).toBe('Asia/Kolkata');
  });

  it.each(['Mars/Olympus_Mons', 'europe/amsterdam', '', 42, null])(
    'saves nothing for %j',
    async (zone) => {
      const jane = await createUser(db, 'jane@adiutor.test');

      expect(await saveFirstTimeZone(ctx, await actorFor(db, jane), zone)).toBeNull();
      expect(await savedTimeZone(jane)).toBeNull();
    },
  );

  it('saves nothing while a staff member is signed in as the user', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const actor = await actorFor(db, jane);
    const signedInAs = {
      ...actor,
      signedInAs: {
        staffId: jane,
        staffName: 'Sam Lee',
        endsAt: new Date(Date.now() + 30 * 60_000),
        returnTo: '/dashboard',
        staffPermissions: [],
      },
    };

    await expect(saveFirstTimeZone(ctx, signedInAs, 'Europe/Amsterdam')).rejects.toMatchObject({
      code: 'signed_in_as',
    });
    expect(await savedTimeZone(jane)).toBeNull();
  });
});
