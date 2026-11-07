/**
 * @file The authorization matrix: every role calls every service behind a
 * server action, and every page loader that checks roles, on their own
 * company, another company, the staff and another user, and the outcome must
 * match the permission tables in `docs/companies-and-roles.md`, down to the
 * kind of refusal (`forbidden` or `not_found`). The expected results are
 * written out by hand (not derived from `src/lib/authz/permissions.ts`), so a
 * change to the rules shows up here as a deliberate edit. Role refusals are
 * checked here, not in the service tests. The refusal of role grants without
 * a recent confirmation is in `people/grant-confirmation.int.test.ts`: it
 * needs actors with a second step, and these have none.
 *
 * Each role's operations run one after another on one world, so every
 * operation that uses up or removes its target (resending, revoking,
 * removing, reactivating, accepting) gets a target of its own in
 * `createWorld`.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { invitation, inviteLink, membership, user } from '@/db/schema';
import type { CompanyRole, PlatformRole } from '@/lib/authz/roles';
import { defined, firstRow } from '@/lib/defined';
import { hashToken } from '@/lib/sign-in/tokens';

import type { Actor } from './actor';
import { listAuditEvents, listAuditLog } from './audit';
import { ServiceError } from './errors';
import {
  listCompanies,
  registerCompany,
  setCompanyActive,
  updateCompany,
} from './people/companies';
import {
  acceptInvitation,
  inviteByEmail,
  inviteManyByEmail,
  listPendingInvitations,
  resendInvitation,
  revokeInvitation,
} from './people/invitations';
import {
  claimInviteLink,
  createInviteLink,
  joinWithInviteLink,
  listInviteLinks,
  revokeInviteLink,
} from './people/invite-links';
import {
  addMember,
  changeMemberRole,
  listAddableCompanies,
  listMembers,
  removeMember,
} from './people/members';
import {
  changeStaffRole,
  getStaffSettings,
  listStaff,
  removeFromStaff,
  renameStaff,
} from './people/staff';
import {
  deactivateUser,
  deleteUser,
  getUserDetail,
  reactivateUser,
  resetUserMfa,
  signOutUserEverywhere,
  userExists,
} from './people/user-admin';
import { registerUser } from './people/user-registration';
import { listUsers } from './people/users';
import { findErrorReference, listRecentErrors } from './recorded-errors';
import {
  addMember as addMembership,
  createCompany,
  createStaffSettings,
  createUser,
  inSequence,
  memberActor,
  setupTestContext,
  staffActor,
  tokenFrom,
} from '../../tests/integration/helpers';

const { ctx, db, sent } = setupTestContext();

/** The roles in the matrix. Company roles are members of company A. */
const ROLES = [
  'watcher',
  'client',
  'company admin',
  'support',
  'finance',
  'manager',
  'platform admin',
] as const;

/** One role in the matrix. */
type MatrixRole = (typeof ROLES)[number];

/** Everything a role is tried on. */
interface World {
  /** The acting user. */
  actor: Actor;
  /** Company A (the company roles' own company). */
  own: { id: string; name: string; slug: string };
  /** Company B (nobody's company in the matrix). */
  other: { id: string; name: string; slug: string };
  /** A Client membership in each company, to change. */
  memberships: { own: string; other: string };
  /** A user outside every company. */
  outsider: string;
  /** A user to delete. */
  deletable: string;
  /** A staff member to change. */
  staffMember: string;
  /** The token of an unused Watcher invite link to company B. */
  linkToOther: string;
  /** An open invitation in each company, to resend. */
  invitationsToResend: { own: string; other: string };
  /** Another open invitation in each company, to revoke. */
  invitationsToRevoke: { own: string; other: string };
  /** The ID of an unused invite link in each company, to revoke. */
  linksToRevoke: { own: string; other: string };
  /** Another Client membership in each company, to remove. */
  membershipsToRemove: { own: string; other: string };
  /** A deactivated user, to reactivate. */
  deactivated: string;
  /** Another staff member, to take off the staff. */
  staffToRemove: string;
  /**
   * The token of an open invitation to company B, addressed to the acting
   * user, that an invite link sent (claimed with their address).
   */
  invitationFromLink: string;
}

/** One operation: what it does, on which target, and how to run it in a world. */
type Operation = [name: string, run: (world: World) => Promise<unknown>];

/**
 * Finds the actor's own membership in company A, first making staff (who
 * aren't members) a Watcher there, so everyone has a role of their own to
 * try to raise.
 *
 * @param world - The world.
 * @returns The membership ID.
 */
async function ownMembership(world: World): Promise<string> {
  const [found] = await db
    .select({ id: membership.id })
    .from(membership)
    .where(and(eq(membership.companyId, world.own.id), eq(membership.userId, world.actor.id)));
  return found?.id ?? addMembership(db, world.own.id, world.actor.id, 'watcher');
}

/**
 * Lists the operations, each named after what it does and on which target.
 *
 * @returns The operations.
 */
function listOperations(): Operation[] {
  return [
    ['list members (own)', (w) => listMembers(ctx, w.actor, w.own.id)],
    ['list members (other)', (w) => listMembers(ctx, w.actor, w.other.id)],
    ['list invitations (own)', (w) => listPendingInvitations(ctx, w.actor, w.own.id)],
    ['list invite links (other)', (w) => listInviteLinks(ctx, w.actor, w.other.id)],
    [
      'invite (own)',
      (w) =>
        inviteByEmail(ctx, w.actor, {
          companyId: w.own.id,
          email: 'new@adiutor.test',
          role: 'watcher',
        }),
    ],
    [
      'invite (other)',
      (w) =>
        inviteByEmail(ctx, w.actor, {
          companyId: w.other.id,
          email: 'new@adiutor.test',
          role: 'watcher',
        }),
    ],
    [
      'bulk invite (own)',
      (w) =>
        inviteManyByEmail(ctx, w.actor, {
          companyId: w.own.id,
          emails: 'bulk.one@adiutor.test, bulk.two@adiutor.test',
          role: 'watcher',
        }),
    ],
    [
      'bulk invite (other)',
      (w) =>
        inviteManyByEmail(ctx, w.actor, {
          companyId: w.other.id,
          emails: 'bulk.one@adiutor.test, bulk.two@adiutor.test',
          role: 'watcher',
        }),
    ],
    [
      'resend invitation (own)',
      (w) =>
        resendInvitation(ctx, w.actor, {
          companyId: w.own.id,
          invitationId: w.invitationsToResend.own,
        }),
    ],
    [
      'resend invitation (other)',
      (w) =>
        resendInvitation(ctx, w.actor, {
          companyId: w.other.id,
          invitationId: w.invitationsToResend.other,
        }),
    ],
    [
      'revoke invitation (own)',
      (w) =>
        revokeInvitation(ctx, w.actor, {
          companyId: w.own.id,
          invitationId: w.invitationsToRevoke.own,
        }),
    ],
    [
      'revoke invitation (other)',
      (w) =>
        revokeInvitation(ctx, w.actor, {
          companyId: w.other.id,
          invitationId: w.invitationsToRevoke.other,
        }),
    ],
    [
      'create invite link (own)',
      (w) => createInviteLink(ctx, w.actor, { companyId: w.own.id, role: 'watcher', validDays: 1 }),
    ],
    [
      'revoke invite link (own)',
      (w) => revokeInviteLink(ctx, w.actor, { companyId: w.own.id, linkId: w.linksToRevoke.own }),
    ],
    [
      'revoke invite link (other)',
      (w) =>
        revokeInviteLink(ctx, w.actor, { companyId: w.other.id, linkId: w.linksToRevoke.other }),
    ],
    ['join with invite link (other)', (w) => joinWithInviteLink(ctx, w.linkToOther, w.actor)],
    [
      'accept invitation a link sent (other)',
      async (w) => {
        const result = await acceptInvitation(ctx, w.invitationFromLink, w.actor);
        // Anything but joining means the world is wrong, not that the rules refused it.
        if (result.status !== 'joined') {
          throw new Error(`Not accepted: ${result.status}`);
        }
      },
    ],
    [
      'change role (own)',
      (w) =>
        changeMemberRole(ctx, w.actor, {
          companyId: w.own.id,
          membershipId: w.memberships.own,
          role: 'watcher',
        }),
    ],
    [
      'change role (other)',
      (w) =>
        changeMemberRole(ctx, w.actor, {
          companyId: w.other.id,
          membershipId: w.memberships.other,
          role: 'watcher',
        }),
    ],
    [
      'remove member (own)',
      (w) =>
        removeMember(ctx, w.actor, {
          companyId: w.own.id,
          membershipId: w.membershipsToRemove.own,
        }),
    ],
    [
      'remove member (other)',
      (w) =>
        removeMember(ctx, w.actor, {
          companyId: w.other.id,
          membershipId: w.membershipsToRemove.other,
        }),
    ],
    [
      'raise own role (own)',
      async (w) =>
        changeMemberRole(ctx, w.actor, {
          companyId: w.own.id,
          membershipId: await ownMembership(w),
          role: 'admin',
        }),
    ],
    [
      'add existing user (own)',
      (w) => addMember(ctx, w.actor, { companyId: w.own.id, userId: w.outsider, role: 'watcher' }),
    ],
    [
      'rename company (own)',
      (w) =>
        updateCompany(ctx, w.actor, { companyId: w.own.id, name: w.own.name, slug: w.own.slug }),
    ],
    [
      '(de)activate company (own)',
      (w) => setCompanyActive(ctx, w.actor, { companyId: w.own.id, active: true }),
    ],
    ['list companies', (w) => listCompanies(ctx, w.actor)],
    [
      'add company',
      (w) =>
        registerCompany(ctx, w.actor, {
          name: 'Adiutor Tests New',
          slug: 'adiutor-tests-new',
          adminEmail: 'boss@adiutor.test',
        }),
    ],
    [
      'invite staff',
      (w) =>
        inviteByEmail(ctx, w.actor, {
          companyId: null,
          email: 'staff@adiutor.test',
          role: 'support',
        }),
    ],
    [
      'create staff invite link',
      (w) =>
        createInviteLink(ctx, w.actor, { companyId: null, role: 'platform_admin', validDays: 1 }),
    ],
    ['list staff invitations', (w) => listPendingInvitations(ctx, w.actor, null)],
    ['list staff', (w) => listStaff(ctx, w.actor)],
    ['view staff settings', (w) => getStaffSettings(ctx, w.actor)],
    ['rename staff', (w) => renameStaff(ctx, w.actor, 'Adiutor Tests')],
    [
      'change staff role',
      (w) => changeStaffRole(ctx, w.actor, { userId: w.staffMember, role: 'finance' }),
    ],
    ['remove from staff', (w) => removeFromStaff(ctx, w.actor, w.staffToRemove)],
    ['list users', (w) => listUsers(ctx, w.actor)],
    ['view user', (w) => getUserDetail(ctx, w.actor, w.outsider)],
    ['check a user exists', (w) => userExists(ctx, w.actor, w.outsider)],
    ['list addable companies', (w) => listAddableCompanies(ctx, w.actor, w.outsider)],
    ['register user', (w) => registerUser(ctx, w.actor, 'registered@adiutor.test')],
    ['reset MFA', (w) => resetUserMfa(ctx, w.actor, w.outsider)],
    ['sign out everywhere', (w) => signOutUserEverywhere(ctx, w.actor, w.outsider)],
    ['deactivate user', (w) => deactivateUser(ctx, w.actor, w.outsider)],
    ['reactivate user', (w) => reactivateUser(ctx, w.actor, w.deactivated)],
    ['delete user', (w) => deleteUser(ctx, w.actor, w.deletable, 'deletable@adiutor.test')],
    ['view audit log', (w) => listAuditEvents(ctx, w.actor, {})],
    ['list the audit log', (w) => listAuditLog(ctx, w.actor)],
    ['look up an error reference', (w) => findErrorReference(ctx, w.actor, '7KQ2-M9XD')],
    ['list recent errors', (w) => listRecentErrors(ctx, w.actor)],
  ];
}

/** The operations by name. */
const OPERATIONS = new Map(listOperations());

/** What happens when a role tries an operation. */
type Outcome = 'allowed' | 'forbidden' | 'not_found';

/** The letters used in `EXPECTED`. */
const OUTCOME_LETTERS: Record<string, Outcome> = {
  A: 'allowed',
  F: 'forbidden',
  N: 'not_found',
};

/**
 * What each operation does for each role: one letter per role, in the order
 * of `ROLES` (watcher, client, company admin, support, finance, manager,
 * platform admin).
 *
 * - `A` allowed: the permission checks let it through.
 * - `F` forbidden: the role can see the target (members see their own
 *   company, staff see every company and the staff) but may not do this.
 * - `N` not found: the role can't see the target, so a company's members get
 *   this for another company and learn nothing about it.
 *
 * The staff and user operations check the permission before they look up the
 * target, so company users get `F` for them even though they can't see the
 * target: the answer doesn't depend on whether it exists.
 */
const EXPECTED: Record<string, string> = {
  'list members (own)': 'FFAAAAA',
  'list members (other)': 'NNNAAAA',
  'list invitations (own)': 'FFAAAAA',
  'list invite links (other)': 'NNNAAAA',
  'invite (own)': 'FFAFFAA',
  'invite (other)': 'NNNFFAA',
  // Refused once, before the first address, as for one address: no failure line per address.
  'bulk invite (own)': 'FFAFFAA',
  'bulk invite (other)': 'NNNFFAA',
  'resend invitation (own)': 'FFAFFAA',
  'resend invitation (other)': 'NNNFFAA',
  'revoke invitation (own)': 'FFAFFAA',
  'revoke invitation (other)': 'NNNFFAA',
  'create invite link (own)': 'FFAFFAA',
  'revoke invite link (own)': 'FFAFFAA',
  'revoke invite link (other)': 'NNNFFAA',
  // Finance and Support can't use invite links; everyone else can (a link is for whoever has it).
  'join with invite link (other)': 'AAAFFAA',
  // Nor accept the invitation a link sent them: the same way in, through their inbox.
  'accept invitation a link sent (other)': 'AAAFFAA',
  'change role (own)': 'FFAFFAA',
  'change role (other)': 'NNNFFAA',
  'remove member (own)': 'FFAFFAA',
  'remove member (other)': 'NNNFFAA',
  // Nobody raises their own role, not even staff who manage members ('admin' is no raise for an Admin).
  'raise own role (own)': 'FFAFFFF',
  'add existing user (own)': 'FFFFFAA',
  'rename company (own)': 'FFFFFAA',
  '(de)activate company (own)': 'FFFFFAA',
  'list companies': 'FFFAAAA',
  'add company': 'FFFFFAA',
  'invite staff': 'FFFFFFA',
  'create staff invite link': 'FFFFFFA',
  'list staff invitations': 'FFFFFFA',
  'list staff': 'FFFFFFA',
  'view staff settings': 'FFFFFFA',
  'rename staff': 'FFFFFFA',
  'change staff role': 'FFFFFFA',
  'remove from staff': 'FFFFFFA',
  'list users': 'FFFAAAA',
  'view user': 'FFFAAAA',
  // The user page's title: whether the user in its URL exists, for the staff who may see users.
  'check a user exists': 'FFFAAAA',
  // The user page's "Add to company" list: staff who see companies.
  'list addable companies': 'FFFAAAA',
  'register user': 'FFFFFAA',
  'reset MFA': 'FFFFFFA',
  'sign out everywhere': 'FFFFFFA',
  'deactivate user': 'FFFFFFA',
  'reactivate user': 'FFFFFFA',
  'delete user': 'FFFFFFA',
  'view audit log': 'FFFFFAA',
  'list the audit log': 'FFFFFAA',
  'look up an error reference': 'FFFFFFA',
  'list recent errors': 'FFFFFFA',
};

/**
 * Looks up what an operation should do for a role.
 *
 * @param operation - The operation's name.
 * @param role - The role.
 * @returns The expected outcome.
 */
function expectedOutcome(operation: string, role: MatrixRole): Outcome {
  const letters = defined(EXPECTED[operation], `the expected outcomes of ${operation}`);
  const letter = defined(
    letters[ROLES.indexOf(role)],
    `the expected outcome of ${operation} for ${role}`,
  );
  return defined(OUTCOME_LETTERS[letter], `the outcome for ${letter}`);
}

/**
 * Creates an unused Watcher invite link to a company.
 *
 * @param admin - Who creates it, an Admin of the company.
 * @param companyId - The company.
 * @returns The link's ID and the token from its URL.
 */
async function createLink(admin: Actor, companyId: string): Promise<{ id: string; token: string }> {
  const { url } = await createInviteLink(ctx, admin, { companyId, role: 'watcher', validDays: 1 });
  const token = defined(url.split('/join/')[1], 'the invite link token');
  const link = firstRow(
    await db
      .select({ id: inviteLink.id })
      .from(inviteLink)
      .where(eq(inviteLink.tokenHash, hashToken(token))),
    'the invite link',
  );
  return { id: link.id, token };
}

/**
 * Sends a Client invitation to a company, which stays open.
 *
 * @param admin - Who sends it, an Admin of the company.
 * @param companyId - The company.
 * @param email - The address invited.
 * @returns The invitation's ID.
 */
async function openInvitation(admin: Actor, companyId: string, email: string): Promise<string> {
  await inviteByEmail(ctx, admin, { companyId, email, role: 'client' });
  const found = firstRow(
    await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(invitation.companyId, companyId),
          eq(invitation.email, email),
          isNull(invitation.revokedAt),
        ),
      ),
    'the invitation',
  );
  return found.id;
}

/**
 * Creates the world for one role.
 *
 * @param role - The role to act as.
 * @returns The world.
 */
async function createWorld(role: MatrixRole): Promise<World> {
  await createStaffSettings(db);
  const own = await createCompany(db, { name: 'Adiutor Tests A' });
  const other = await createCompany(db, { name: 'Adiutor Tests B' });
  // Each company keeps an admin, so changes never hit the last-admin rule.
  const ownAdmin = await memberActor(db, own.id, 'admin');
  const otherAdmin = await memberActor(db, other.id, 'admin');
  const memberships = {
    own: await addMembership(db, own.id, await createUser(db, 'a.client@adiutor.test'), 'client'),
    other: await addMembership(
      db,
      other.id,
      await createUser(db, 'b.client@adiutor.test'),
      'client',
    ),
  };
  const staffMember = (await staffActor(db, 'support', 'staff.member@adiutor.test')).id;
  const staffToRemove = (await staffActor(db, 'support', 'staff.removable@adiutor.test')).id;
  // Another staff Admin, so the platform Admin is never the last one.
  await staffActor(db, 'platform_admin');
  const deactivated = await createUser(db, 'deactivated@adiutor.test');
  await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, deactivated));
  const roleOf: Record<MatrixRole, { company: CompanyRole } | { staff: PlatformRole }> = {
    watcher: { company: 'watcher' },
    client: { company: 'client' },
    'company admin': { company: 'admin' },
    support: { staff: 'support' },
    finance: { staff: 'finance' },
    manager: { staff: 'manager' },
    'platform admin': { staff: 'platform_admin' },
  };
  const spec = roleOf[role];
  const actor =
    'company' in spec
      ? await memberActor(db, own.id, spec.company)
      : await staffActor(db, spec.staff);
  // Claiming a link with the actor's address turns it into an invitation to them that a link sent.
  await claimInviteLink(ctx, (await createLink(otherAdmin, other.id)).token, actor.email);
  const invitationFromLink = tokenFrom(defined(sent.at(-1), 'the invitation email'));
  return {
    actor,
    own,
    other,
    memberships,
    outsider: await createUser(db, 'outsider@adiutor.test'),
    deletable: await createUser(db, 'deletable@adiutor.test'),
    staffMember,
    linkToOther: (await createLink(otherAdmin, other.id)).token,
    invitationsToResend: {
      own: await openInvitation(ownAdmin, own.id, 'a.resend@adiutor.test'),
      other: await openInvitation(otherAdmin, other.id, 'b.resend@adiutor.test'),
    },
    invitationsToRevoke: {
      own: await openInvitation(ownAdmin, own.id, 'a.revoke@adiutor.test'),
      other: await openInvitation(otherAdmin, other.id, 'b.revoke@adiutor.test'),
    },
    linksToRevoke: {
      own: (await createLink(ownAdmin, own.id)).id,
      other: (await createLink(otherAdmin, other.id)).id,
    },
    membershipsToRemove: {
      own: await addMembership(
        db,
        own.id,
        await createUser(db, 'a.removable@adiutor.test'),
        'client',
      ),
      other: await addMembership(
        db,
        other.id,
        await createUser(db, 'b.removable@adiutor.test'),
        'client',
      ),
    },
    deactivated,
    staffToRemove,
    invitationFromLink,
  };
}

/**
 * Runs an operation and reports whether the permission checks let it through,
 * and if not, how they refused. Other refusals (a conflict, invalid input)
 * still mean it was allowed.
 *
 * @param run - The operation.
 * @returns `allowed`, `forbidden` or `not_found`.
 */
async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    await run();
    return 'allowed';
  } catch (error) {
    if (!(error instanceof ServiceError)) {
      throw error;
    }
    return error.code === 'forbidden' || error.code === 'not_found' ? error.code : 'allowed';
  }
}

describe('authorization matrix', () => {
  it('expects an outcome of every operation for every role', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...OPERATIONS.keys()].sort());
    Object.entries(EXPECTED).forEach(([operation, letters]) => {
      expect(letters, operation).toHaveLength(ROLES.length);
      expect(
        [...letters].every((letter) => letter in OUTCOME_LETTERS),
        operation,
      ).toBe(true);
    });
  });

  it.each(ROLES)('%s may do exactly what the permission table says', async (role) => {
    const world = await createWorld(role);
    const names = [...OPERATIONS.keys()];
    const results = await inSequence(names, async (name) => [
      name,
      await outcome(() => defined(OPERATIONS.get(name), `the ${name} operation`)(world)),
    ]);
    const expected = names.map((name) => [name, expectedOutcome(name, role)]);
    expect(Object.fromEntries(results)).toEqual(Object.fromEntries(expected));
  });
});
