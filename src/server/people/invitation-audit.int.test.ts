/**
 * @file Integration tests for what invitations and invite links write to the
 * audit log, for companies and for staff, so refactoring the services keeps
 * the log's contents exactly.
 */
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { auditEvent, invitation, inviteLink } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import {
  atTheSameMoment,
  createCompany,
  createStaffSettings,
  createUser,
  setupTestContext,
  staffActor,
  tokenFrom,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { registerCompany } from './companies';
import {
  acceptInvitation,
  createSentInvitation,
  inviteByEmail,
  resendInvitation,
  revokeInvitation,
} from './invitations';
import {
  claimInviteLink,
  createInviteLink,
  joinWithInviteLink,
  revokeInviteLink,
} from './invite-links';

const { ctx, db, sent } = setupTestContext();

let admin: Actor;
/** The company invited to. */
let testCompany: Awaited<ReturnType<typeof createCompany>>;

beforeEach(async () => {
  await createStaffSettings(db);
  admin = await staffActor(db, 'platform_admin', 'admin@adiutor.test');
  testCompany = await createCompany(db);
});

/**
 * Reads the audit log, oldest first.
 *
 * @returns The events' recorded fields.
 */
async function events() {
  return db
    .select({
      action: auditEvent.action,
      actorUserId: auditEvent.actorUserId,
      targetUserId: auditEvent.targetUserId,
      companyId: auditEvent.companyId,
      details: auditEvent.details,
    })
    .from(auditEvent)
    .orderBy(asc(auditEvent.id));
}

/**
 * Finds the open invitation for an address.
 *
 * @param email - The invited address.
 * @returns Its ID.
 */
async function invitationFor(email: string): Promise<string> {
  const found = firstRow(
    await db.select({ id: invitation.id }).from(invitation).where(eq(invitation.email, email)),
    'the invitation',
  );
  return found.id;
}

describe.each([
  { target: 'a company', staff: false, role: 'client' },
  { target: 'the staff', staff: true, role: 'support' },
] as const)('audit log of invitations to $target', ({ staff, role }) => {
  /**
   * The audit fields of the target.
   *
   * @returns The company ID, and the details' staff marker.
   */
  const target = () => ({
    companyId: staff ? null : testCompany.id,
    marker: staff ? { staff: true } : {},
  });

  it('records sending, resending, revoking and accepting an invitation', async () => {
    const companyId = staff ? null : testCompany.id;
    const email = 'jane@adiutor.test';

    await inviteByEmail(ctx, admin, { companyId, email, role });
    await resendInvitation(ctx, admin, { companyId, invitationId: await invitationFor(email) });
    const token = tokenFrom(defined(sent[sent.length - 1], 'the last email'));
    const jane = await createUser(db, email);
    await acceptInvitation(ctx, token, { id: jane, email, platformRole: null });
    await inviteByEmail(ctx, admin, { companyId, email: 'john@adiutor.test', role });
    await revokeInvitation(ctx, admin, {
      companyId,
      invitationId: await invitationFor('john@adiutor.test'),
    });

    const { marker } = target();
    expect(await events()).toEqual([
      {
        action: 'invitation_sent',
        actorUserId: admin.id,
        targetUserId: null,
        companyId: target().companyId,
        details: { ...marker, email, role, status: 'sent' },
      },
      {
        action: 'invitation_sent',
        actorUserId: admin.id,
        targetUserId: null,
        companyId: target().companyId,
        details: { ...marker, email, role, resent: true },
      },
      {
        action: 'member_joined',
        actorUserId: jane,
        targetUserId: jane,
        companyId: target().companyId,
        details: { ...marker, role, email },
      },
      {
        action: 'invitation_sent',
        actorUserId: admin.id,
        targetUserId: null,
        companyId: target().companyId,
        details: { ...marker, email: 'john@adiutor.test', role, status: 'sent' },
      },
      {
        action: 'invitation_revoked',
        actorUserId: admin.id,
        targetUserId: null,
        companyId: target().companyId,
        details: { ...marker, email: 'john@adiutor.test', role },
      },
    ]);
  });

  it('records both of two invitations to one address at the same moment', async () => {
    const companyId = staff ? null : testCompany.id;
    const email = 'jane@adiutor.test';

    const { second } = await atTheSameMoment(
      db,
      (tx) =>
        createSentInvitation(ctx, tx, admin, {
          target: { companyId, name: 'Adiutor Tests' },
          email,
          role,
        }),
      () => inviteByEmail(ctx, admin, { companyId, email, role }),
    );

    // One event per invitation sent, as if they had come one after another.
    expect(second.status).toBe('fulfilled');
    const { marker } = target();
    const sentEvent = {
      action: 'invitation_sent',
      actorUserId: admin.id,
      targetUserId: null,
      companyId: target().companyId,
      details: { ...marker, email, role, status: 'sent' },
    };
    expect(await events()).toEqual([sentEvent, sentEvent]);
  });

  it('records creating, revoking, claiming and joining with invite links', async () => {
    const companyId = staff ? null : testCompany.id;
    await createInviteLink(ctx, admin, { companyId, role, validDays: 7 });
    const revocable = firstRow(
      await db.select({ id: inviteLink.id }).from(inviteLink),
      'the invite link',
    );
    await revokeInviteLink(ctx, admin, { companyId, linkId: revocable.id });
    const claimed = await createInviteLink(ctx, admin, { companyId, role, validDays: 1 });
    await claimInviteLink(
      ctx,
      defined(claimed.url.split('/join/')[1], 'the link token'),
      'jane@adiutor.test',
    );
    const joined = await createInviteLink(ctx, admin, { companyId, role, validDays: 30 });
    const john = await createUser(db, 'john@adiutor.test');
    await joinWithInviteLink(ctx, defined(joined.url.split('/join/')[1], 'the link token'), {
      id: john,
      email: 'john@adiutor.test',
      platformRole: null,
    });

    const { marker } = target();
    expect(await events()).toEqual([
      {
        action: 'invite_link_created',
        actorUserId: admin.id,
        targetUserId: null,
        companyId: target().companyId,
        details: { ...marker, role, validDays: 7 },
      },
      {
        action: 'invite_link_revoked',
        actorUserId: admin.id,
        targetUserId: null,
        companyId: target().companyId,
        details: { ...marker, role },
      },
      {
        action: 'invite_link_created',
        actorUserId: admin.id,
        targetUserId: null,
        companyId: target().companyId,
        details: { ...marker, role, validDays: 1 },
      },
      {
        action: 'invite_link_claimed',
        actorUserId: null,
        targetUserId: null,
        companyId: target().companyId,
        details: { ...marker, email: 'jane@adiutor.test', role, status: 'sent' },
      },
      {
        action: 'invite_link_created',
        actorUserId: admin.id,
        targetUserId: null,
        companyId: target().companyId,
        details: { ...marker, role, validDays: 30 },
      },
      {
        action: 'member_joined',
        actorUserId: john,
        targetUserId: john,
        companyId: target().companyId,
        details: { ...marker, role, via: 'invite_link' },
      },
    ]);
  });
});

describe('audit log of registering a company', () => {
  it('records the new company, then the invitation of its Admin', async () => {
    const { companyId } = await registerCompany(ctx, admin, {
      name: 'Adiutor Tests Two',
      slug: 'adiutor-tests-two',
      adminEmail: 'jane@adiutor.test',
    });

    expect(await events()).toEqual([
      {
        action: 'company_created',
        actorUserId: admin.id,
        targetUserId: null,
        companyId,
        details: { name: 'Adiutor Tests Two', slug: 'adiutor-tests-two' },
      },
      {
        action: 'invitation_sent',
        actorUserId: admin.id,
        targetUserId: null,
        companyId,
        details: { email: 'jane@adiutor.test', role: 'admin', status: 'sent' },
      },
    ]);
  });
});
