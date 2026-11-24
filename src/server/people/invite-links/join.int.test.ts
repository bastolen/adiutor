/**
 * @file Integration tests for a signed-in user joining a company with an invite
 * link directly, and for who may not.
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { membership } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import { actorFor, createUser, staffActor } from '../../../../tests/integration/helpers';
import { joinWithInviteLink } from './join';
import { ctx, db, newLinkToken, testCompany } from './test-helpers';

describe('invite links', () => {
  it('let a signed-in user join directly', async () => {
    const token = await newLinkToken();
    const joiner = await actorFor(db, await createUser(db, 'joiner@adiutor.test'));
    expect(await joinWithInviteLink(ctx, token, joiner)).toEqual({
      status: 'joined',
      companyId: testCompany.id,
      signedOut: false,
    });
    const joined = firstRow(
      await db
        .select()
        .from(membership)
        .where(and(eq(membership.companyId, testCompany.id), eq(membership.userId, joiner.id))),
      'the new membership',
    );
    expect(joined.role).toBe('client');
  });

  it("can't be used by Finance or Support, and stay usable for someone else", async () => {
    const token = await newLinkToken();
    await Promise.all(
      (['finance', 'support'] as const).map(async (role) => {
        const viewer = await staffActor(db, role);
        await expect(joinWithInviteLink(ctx, token, viewer)).rejects.toMatchObject({
          code: 'forbidden',
          key: 'errors.inviteLinks.notAllowed',
        });
      }),
    );
    expect(
      await db.select().from(membership).where(eq(membership.companyId, testCompany.id)),
    ).toHaveLength(1);

    // The refusals didn't use the link up.
    const joiner = await actorFor(db, await createUser(db, 'joiner@adiutor.test'));
    expect(await joinWithInviteLink(ctx, token, joiner)).toMatchObject({ status: 'joined' });
  });

  it('can be used by staff Managers and Admins', async () => {
    const manager = await staffActor(db, 'manager');
    expect(await joinWithInviteLink(ctx, await newLinkToken(), manager)).toMatchObject({
      status: 'joined',
    });
    const staffAdmin = await staffActor(db, 'platform_admin');
    expect(await joinWithInviteLink(ctx, await newLinkToken(), staffAdmin)).toMatchObject({
      status: 'joined',
    });
  });
});
