/**
 * @file Integration tests for a person's own time zone: the first visit saves
 * the browser's zone only while the account has none, a zone Adiutor doesn't
 * accept is never saved, the Time zone card saves another, and nothing is
 * saved while a staff member is signed in as the user.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { user, staffSettings } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import {
  actorFor,
  createStaffSettings,
  createUser,
  setupTestContext,
} from '../../../tests/integration/helpers';
import { loadActor } from '../actor';
import saveFirstTimeZone, { ownTimeZone, setOwnTimeZone } from './own-time-zone';

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

describe('setOwnTimeZone', () => {
  it('saves the chosen zone over the one the account had', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ timeZone: 'Asia/Tokyo' }).where(eq(user.id, jane));

    await expect(setOwnTimeZone(ctx, await actorFor(db, jane), 'America/New_York')).resolves.toBe(
      'America/New_York',
    );
    expect(await savedTimeZone(jane)).toBe('America/New_York');
  });

  it('refuses a zone Adiutor doesn’t accept, keeping the saved one', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ timeZone: 'Asia/Tokyo' }).where(eq(user.id, jane));

    await expect(setOwnTimeZone(ctx, await actorFor(db, jane), 'europe/amsterdam')).rejects.toThrow(
      'validation.timeZone',
    );
    expect(await savedTimeZone(jane)).toBe('Asia/Tokyo');
  });
});

describe('ownTimeZone', () => {
  it('gives the account’s zone and Adiutor’s default, which stands in while it has none', async () => {
    await createStaffSettings(db);
    await db.update(staffSettings).set({ defaultTimeZone: 'Europe/Amsterdam' });
    const jane = await createUser(db, 'jane@adiutor.test');

    expect(await ownTimeZone(ctx, await actorFor(db, jane))).toEqual({
      timeZone: null,
      defaultTimeZone: 'Europe/Amsterdam',
    });
    await setOwnTimeZone(ctx, await actorFor(db, jane), 'Asia/Tokyo');
    expect(await ownTimeZone(ctx, await actorFor(db, jane))).toEqual({
      timeZone: 'Asia/Tokyo',
      defaultTimeZone: 'Europe/Amsterdam',
    });
  });
});
