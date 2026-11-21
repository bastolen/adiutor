/**
 * @file Integration tests for how the user reads a request's activity:
 * everything, oldest first, until they choose; saved for themselves only,
 * tidied the one way it's saved; an order or group there isn't is refused;
 * and a stored value this version doesn't know counts as nothing saved. That
 * it's refused while a staff member is signed in as them is in the
 * authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { user } from '@/db/schema';

import { createCompany, memberActor, staffActor } from '../../../tests/integration/helpers';
import { readActivityView, setActivityView } from './activity-view';
import { ctx, db } from './test-helpers';

describe('setActivityView and readActivityView', () => {
  it('show everything, oldest first, until the user chooses', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');

    expect(await readActivityView(db, client.id)).toEqual({ order: 'oldest', groups: null });
  });

  it('save the order and the groups apart, for the user alone', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const colleague = await memberActor(db, company.id, 'client');

    expect(await setActivityView(ctx, client, { order: 'newest' })).toEqual({
      order: 'newest',
      groups: null,
    });
    expect(await setActivityView(ctx, client, { groups: ['status', 'replies'] })).toEqual({
      order: 'newest',
      groups: ['replies', 'status'],
    });
    expect(await readActivityView(db, colleague.id)).toEqual({ order: 'oldest', groups: null });

    // Back to the defaults, which are stored as nothing.
    await setActivityView(ctx, client, { order: 'oldest', groups: null });
    const [stored] = await db
      .select({ order: user.activityOrder, groups: user.activityGroups })
      .from(user)
      .where(eq(user.id, client.id));
    expect(stored).toEqual({ order: null, groups: null });
  });

  it('tidy the groups: the notes go within Replies, and everything or nothing is everything', async () => {
    const support = await staffActor(db, 'support');

    expect((await setActivityView(ctx, support, { groups: ['notes', 'replies'] })).groups).toEqual([
      'replies',
    ]);
    expect((await setActivityView(ctx, support, { groups: ['notes', 'status'] })).groups).toEqual([
      'notes',
      'status',
    ]);
    expect(
      (await setActivityView(ctx, support, { groups: ['replies', 'status', 'changes'] })).groups,
    ).toBeNull();
    expect((await setActivityView(ctx, support, { groups: [] })).groups).toBeNull();
  });

  it('refuse an order or a group there isn’t, and save nothing', async () => {
    const support = await staffActor(db, 'support');
    await setActivityView(ctx, support, { order: 'newest', groups: ['status'] });

    await expect(setActivityView(ctx, support, { order: 'random' })).rejects.toThrow(ZodError);
    await expect(setActivityView(ctx, support, { groups: ['comment'] })).rejects.toThrow(ZodError);
    await expect(setActivityView(ctx, support, 'newest')).rejects.toThrow(ZodError);

    expect(await readActivityView(db, support.id)).toEqual({ order: 'newest', groups: ['status'] });
  });

  it('read a stored value this version doesn’t know as nothing saved', async () => {
    const support = await staffActor(db, 'support');
    await db
      .update(user)
      .set({ activityGroups: ['attachments', 'status'] })
      .where(eq(user.id, support.id));
    expect(await readActivityView(db, support.id)).toEqual({ order: 'oldest', groups: ['status'] });

    await db
      .update(user)
      .set({ activityGroups: ['attachments'] })
      .where(eq(user.id, support.id));
    expect(await readActivityView(db, support.id)).toEqual({ order: 'oldest', groups: null });
  });
});
