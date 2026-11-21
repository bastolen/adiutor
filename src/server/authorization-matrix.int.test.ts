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
 * needs actors with a second step, and these have none. The same goes for
 * changing or first setting a password (`changeOwnPassword`,
 * `setFirstPassword`), which need a second step or a fresh sign-in and are
 * covered in `auth/accounts.int.test.ts`. Signing in as a user needs strong
 * MFA and a recent confirmation with it, so the matrix gives the actor those
 * and a session, leaving only the role to decide; the rest of its rules are
 * in `auth/impersonation.int.test.ts`. The own-account services that take
 * an ID (`revokeOwnSession`, `confirmConnectedProvider`) are tried with
 * another user's ID, and `deactivateOwnAccount` with a password; its refusal
 * of the last Admin is the last test below.
 *
 * An operation the permission checks let through must also succeed: another
 * refusal (invalid input, a missing confirmation, a limit) fails the matrix
 * unless the operation's row in `ALSO_ALLOWED` names its code, so a service
 * that refuses for the wrong reason can't pass as "allowed".
 *
 * While a staff member is signed in as the acting user, every operation that
 * changes something is refused (`signed_in_as`, see `assertNotSignedInAs`),
 * except the user's own work (`OWN_WORK`), and the reads (`READS`) give what
 * they give the user; a new operation counts as a change unless it's listed.
 *
 * Each role's operations run one after another on one world, so every
 * operation that uses up or removes its target (resending, revoking,
 * removing, reactivating, accepting) gets a target of its own in
 * `createWorld`.
 */
import { hashPassword } from 'better-auth/crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { account, impersonation, invitation, inviteLink, membership, user } from '@/db/schema';
import type { CompanyRole, PlatformRole } from '@/lib/authz/roles';
import { defined, firstRow } from '@/lib/defined';
import { hashToken } from '@/lib/sign-in/tokens';

import {
  addMember as addMembership,
  connectProvider,
  createCompany,
  createSession,
  createStaffSettings,
  createUser,
  inSequence,
  memberActor,
  setupTestContext,
  staffActor,
  storeQueuedJob,
  tokenFrom,
} from '../../tests/integration/helpers';
import type { Actor } from './actor';
import { listAuditEvents, listAuditLog } from './audit';
import { confirmConnectedProvider } from './auth/accounts';
import {
  impersonationVerdictFor,
  setStaffSignInAllowed,
  startImpersonation,
} from './auth/impersonation';
import { revokeOwnSession } from './auth/sessions';
import { ServiceError, type ServiceErrorCode } from './errors';
import {
  discardFailedJobs,
  listFailedJobs,
  listJobRuns,
  loadJobsOverview,
  pauseJob,
  resumeJob,
  retryFailedJobs,
  runJobFromPage,
} from './jobs';
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
import { dismissMfaRecommendation } from './people/mfa-recommendation';
import setOwnLocale from './people/own-locale';
import saveFirstTimeZone, { setOwnTimeZone } from './people/own-time-zone';
import { setOwnPicture } from './people/pictures';
import { setOwnRequestEmails } from './people/request-emails';
import {
  changeStaffRole,
  getStaffSettings,
  listStaff,
  removeFromStaff,
  renameStaff,
  setDefaultTimeZone,
  setLanguages,
  setRequestPrefix,
} from './people/staff';
import {
  deactivateOwnAccount,
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
  addNote,
  addRequestType,
  archiveRequestType,
  changeAssignees,
  changeRequestStatus,
  changeSubscribers,
  countAssignedRequests,
  editReply,
  editRequestDescription,
  findRequest,
  getRequest,
  listAssignableStaff,
  listMentionable,
  listRequestCompanies,
  listRequests,
  listRequestTypes,
  listSubscribable,
  moveRequestType,
  raiseRequest,
  replyToRequest,
  restoreRequestType,
  setActivityView,
  subscribe,
  unsubscribe,
  updateRequestDetails,
  updateRequestType,
} from './requests';

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
  /** A session of that user, which isn't the acting user's. */
  othersSession: string;
  /** An unconfirmed provider account of that user, which isn't the acting user's. */
  othersAccount: string;
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
  /** A queued job that was given up, to retry, and another to discard. */
  failedJobs: { retry: string; discard: string };
  /** The number of a request in each company, raised by its Admin. */
  requests: { own: string; other: string };
}

/**
 * A request's details as the staff's form sends them, with a new title, and
 * the details it started from: those of {@link NEW_REQUEST}, a bug.
 */
const NEW_DETAILS = {
  title: 'The printer on floor 2 is broken',
  type: 'hotfix',
  priority: 'high',
  was: { title: 'The printer is broken', type: 'bug', priority: 'normal' },
};

/** A request as its form sends it, without its company. */
const NEW_REQUEST = {
  title: 'The printer is broken',
  description: 'It prints blank pages.',
  type: 'bug',
} as const;

/** The password the acting user is given in `deactivate own account`. */
const OWN_PASSWORD = 'correct horse battery';

/**
 * Gives a user a password, as Better Auth stores it.
 *
 * @param userId - The user.
 */
async function givePassword(userId: string): Promise<void> {
  await db.insert(account).values({
    userId,
    accountId: userId,
    providerId: 'credential',
    password: await hashPassword(OWN_PASSWORD),
  });
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
    ['list invitations (other)', (w) => listPendingInvitations(ctx, w.actor, w.other.id)],
    ['list invite links (own)', (w) => listInviteLinks(ctx, w.actor, w.own.id)],
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
      'create invite link (other)',
      (w) =>
        createInviteLink(ctx, w.actor, { companyId: w.other.id, role: 'watcher', validDays: 1 }),
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
      'add existing user (other)',
      (w) =>
        addMember(ctx, w.actor, { companyId: w.other.id, userId: w.outsider, role: 'watcher' }),
    ],
    // A new name each, so the rename changes something; the URL name stays.
    [
      'rename company (own)',
      (w) =>
        updateCompany(ctx, w.actor, {
          companyId: w.own.id,
          name: `${w.own.name} Renamed`,
          slug: w.own.slug,
        }),
    ],
    [
      'rename company (other)',
      (w) =>
        updateCompany(ctx, w.actor, {
          companyId: w.other.id,
          name: `${w.other.name} Renamed`,
          slug: w.other.slug,
        }),
    ],
    // Each company is deactivated and then reactivated, so both really change it and the
    // operations after them find it active again.
    [
      'deactivate company (own)',
      (w) => setCompanyActive(ctx, w.actor, { companyId: w.own.id, active: false }),
    ],
    [
      'reactivate company (own)',
      (w) => setCompanyActive(ctx, w.actor, { companyId: w.own.id, active: true }),
    ],
    [
      'deactivate company (other)',
      (w) => setCompanyActive(ctx, w.actor, { companyId: w.other.id, active: false }),
    ],
    [
      'reactivate company (other)',
      (w) => setCompanyActive(ctx, w.actor, { companyId: w.other.id, active: true }),
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
    ['choose own language', (w) => setOwnLocale(ctx, w.actor, 'nl-NL')],
    ['save own first time zone', (w) => saveFirstTimeZone(ctx, w.actor, 'Europe/Amsterdam')],
    ['choose own time zone', (w) => setOwnTimeZone(ctx, w.actor, 'Europe/Amsterdam')],
    ['choose own picture', (w) => setOwnPicture(ctx, w.actor, 'initials')],
    ['turn off own emails about requests', (w) => setOwnRequestEmails(ctx, w.actor, false)],
    [
      'choose how own request activity reads',
      (w) => setActivityView(ctx, w.actor, { order: 'newest', groups: ['replies'] }),
    ],
    ['dismiss own MFA recommendation', (w) => dismissMfaRecommendation(ctx, w.actor)],
    ['turn off sign-ins by staff', (w) => setStaffSignInAllowed(ctx, w.actor, false)],
    ["sign out another user's device", (w) => revokeOwnSession(ctx, w.actor, w.othersSession)],
    [
      "confirm another user's provider account",
      // With a fresh sign-in, which the actors here lack, so only the account's owner decides.
      (w) => confirmConnectedProvider(ctx, { ...w.actor, signedInAt: new Date() }, w.othersAccount),
    ],
    ['rename staff', (w) => renameStaff(ctx, w.actor, 'Adiutor Tests')],
    [
      'set languages',
      (w) => setLanguages(ctx, w.actor, { defaultLocale: 'nl-NL', offered: ['en-US', 'nl-NL'] }),
    ],
    ['set default time zone', (w) => setDefaultTimeZone(ctx, w.actor, 'Europe/Amsterdam')],
    ['set request prefix', (w) => setRequestPrefix(ctx, w.actor, 'HELP')],
    ['list request types', (w) => listRequestTypes(ctx, w.actor)],
    [
      'add request type',
      (w) =>
        addRequestType(ctx, w.actor, {
          name: 'Printers',
          description: 'A printer acts up.',
          startingPriority: 'normal',
        }),
    ],
    [
      'edit request type',
      (w) =>
        updateRequestType(ctx, w.actor, {
          type: 'support',
          name: 'Help',
          description: 'A question.',
          startingPriority: 'normal',
        }),
    ],
    ['move request type', (w) => moveRequestType(ctx, w.actor, { type: 'bug', direction: 'up' })],
    ['archive request type', (w) => archiveRequestType(ctx, w.actor, { type: 'new_feature' })],
    ['restore request type', (w) => restoreRequestType(ctx, w.actor, { type: 'new_feature' })],
    [
      'change staff role',
      (w) => changeStaffRole(ctx, w.actor, { userId: w.staffMember, role: 'finance' }),
    ],
    ['remove from staff', (w) => removeFromStaff(ctx, w.actor, w.staffToRemove)],
    ['list users', (w) => listUsers(ctx, w.actor)],
    ['view user', (w) => getUserDetail(ctx, w.actor, w.outsider)],
    ['check a user exists', (w) => userExists(ctx, w.actor, w.outsider)],
    ['check signing in as a user', (w) => impersonationVerdictFor(ctx, w.actor, w.outsider)],
    ['list addable companies', (w) => listAddableCompanies(ctx, w.actor, w.outsider)],
    [
      'sign in as a user',
      // Before `deactivate user` deactivates the outsider. In a session of their own, with the
      // strong MFA it needs, which the actors here lack, so only the role decides.
      async (w) =>
        startImpersonation(
          ctx,
          {
            ...w.actor,
            sessionId: await createSession(db, w.actor.id),
            strongMfa: true,
            strongMfaConfirmedUntil: new Date(Date.now() + 60_000),
          },
          { userId: w.outsider },
        ),
    ],
    ['register user', (w) => registerUser(ctx, w.actor, 'registered@adiutor.test')],
    ['reset MFA', (w) => resetUserMfa(ctx, w.actor, w.outsider)],
    ['sign out everywhere', (w) => signOutUserEverywhere(ctx, w.actor, w.outsider)],
    ['deactivate user', (w) => deactivateUser(ctx, w.actor, w.outsider)],
    ['reactivate user', (w) => reactivateUser(ctx, w.actor, w.deactivated)],
    ['delete user', (w) => deleteUser(ctx, w.actor, w.deletable, 'deletable@adiutor.test')],
    ['view audit log', (w) => listAuditEvents(ctx, w.actor, w.outsider)],
    ['list the audit log', (w) => listAuditLog(ctx, w.actor)],
    ['look up an error reference', (w) => findErrorReference(ctx, w.actor, '7KQ2-M9XD')],
    ['list recent errors', (w) => listRecentErrors(ctx, w.actor)],
    ['view jobs', (w) => loadJobsOverview(ctx, w.actor)],
    ['list job runs', (w) => listJobRuns(ctx, w.actor)],
    ['list failed queued jobs', (w) => listFailedJobs(ctx, w.actor)],
    // Pausing first, so resuming finds it paused when it's allowed.
    ['pause a job', (w) => pauseJob(ctx, w.actor, 'retention')],
    ['resume a job', (w) => resumeJob(ctx, w.actor, 'retention')],
    ['run a job now', (w) => runJobFromPage(ctx, w.actor, 'retention')],
    ['retry a failed queued job', (w) => retryFailedJobs(ctx, w.actor, { id: w.failedJobs.retry })],
    [
      'discard a failed queued job',
      (w) => discardFailedJobs(ctx, w.actor, { id: w.failedJobs.discard }),
    ],
    // Last: it deactivates the acting user.
    ['list requests', (w) => listRequests(ctx, w.actor)],
    ['list requests (own)', (w) => listRequests(ctx, w.actor, { company: w.own.id })],
    ['list requests (other)', (w) => listRequests(ctx, w.actor, { company: w.other.id })],
    ['list companies to raise a request for', (w) => listRequestCompanies(ctx, w.actor)],
    ['look up a request (own)', (w) => findRequest(ctx, w.actor, w.requests.own)],
    ['look up a request (other)', (w) => findRequest(ctx, w.actor, w.requests.other)],
    ['view request (own)', (w) => getRequest(ctx, w.actor, w.requests.own)],
    ['view request (other)', (w) => getRequest(ctx, w.actor, w.requests.other)],
    [
      'raise request (own)',
      (w) => raiseRequest(ctx, w.actor, { ...NEW_REQUEST, companyId: w.own.id }),
    ],
    [
      'raise request (other)',
      (w) => raiseRequest(ctx, w.actor, { ...NEW_REQUEST, companyId: w.other.id }),
    ],
    [
      'reply to request (own)',
      (w) => replyToRequest(ctx, w.actor, { request: w.requests.own, body: 'Any news?' }),
    ],
    [
      'reply to request (other)',
      (w) => replyToRequest(ctx, w.actor, { request: w.requests.other, body: 'Any news?' }),
    ],
    [
      'reply and wait for the company (own)',
      (w) =>
        replyToRequest(ctx, w.actor, {
          request: w.requests.own,
          body: 'Which printer is it?',
          status: 'waiting',
        }),
    ],
    // In this order, each on the request as the one before left it: done, then cancelled or
    // (for the company, which can't cancel a done request) still done, then open again.
    [
      'mark request done (own)',
      (w) => changeRequestStatus(ctx, w.actor, { request: w.requests.own, status: 'done' }),
    ],
    [
      'cancel request (own)',
      (w) => changeRequestStatus(ctx, w.actor, { request: w.requests.own, status: 'cancelled' }),
    ],
    [
      'reopen request (own)',
      (w) => changeRequestStatus(ctx, w.actor, { request: w.requests.own, status: 'open' }),
    ],
    [
      'set request status (own)',
      (w) => changeRequestStatus(ctx, w.actor, { request: w.requests.own, status: 'todo' }),
    ],
    [
      'set request status (other)',
      (w) => changeRequestStatus(ctx, w.actor, { request: w.requests.other, status: 'todo' }),
    ],
    [
      'edit request details (own)',
      (w) => updateRequestDetails(ctx, w.actor, { ...NEW_DETAILS, request: w.requests.own }),
    ],
    [
      'edit request details (other)',
      (w) => updateRequestDetails(ctx, w.actor, { ...NEW_DETAILS, request: w.requests.other }),
    ],
    // The actor assigns themselves: anyone who may assign can be assigned.
    [
      'assign request (own)',
      (w) =>
        changeAssignees(ctx, w.actor, { request: w.requests.own, add: [w.actor.id], remove: [] }),
    ],
    [
      'assign request (other)',
      (w) =>
        changeAssignees(ctx, w.actor, { request: w.requests.other, add: [w.actor.id], remove: [] }),
    ],
    ['list staff to assign', (w) => listAssignableStaff(ctx, w.actor)],
    [
      'edit request description (own)',
      (w) =>
        editRequestDescription(ctx, w.actor, {
          request: w.requests.own,
          text: 'The printer prints blank pages since Monday.',
          edits: 0,
        }),
    ],
    [
      'edit request description (other)',
      (w) =>
        editRequestDescription(ctx, w.actor, {
          request: w.requests.other,
          text: 'The printer prints blank pages since Monday.',
          edits: 0,
        }),
    ],
    // Nobody in the world wrote a reply to edit: past the permission, it's someone else's.
    [
      'edit a reply that is not your own (own)',
      (w) =>
        editReply(ctx, w.actor, {
          request: w.requests.own,
          entry: '0198a8c0-0000-7000-8000-000000000099',
          text: 'Mine now.',
          edits: 0,
        }),
    ],
    [
      'add internal note (own)',
      (w) => addNote(ctx, w.actor, { request: w.requests.own, body: 'Probably the toner.' }),
    ],
    [
      'add internal note (other)',
      (w) => addNote(ctx, w.actor, { request: w.requests.other, body: 'Probably the toner.' }),
    ],
    [
      'list who can be mentioned in a request (own)',
      (w) => listMentionable(ctx, w.actor, { request: w.requests.own }),
    ],
    [
      'list who can be mentioned in a request (other)',
      (w) => listMentionable(ctx, w.actor, { request: w.requests.other }),
    ],
    [
      'list who can be mentioned in a new request (own)',
      (w) => listMentionable(ctx, w.actor, { company: w.own.id }),
    ],
    [
      'list who can be mentioned in a new request (other)',
      (w) => listMentionable(ctx, w.actor, { company: w.other.id }),
    ],
    ['count own assigned requests', (w) => countAssignedRequests(ctx, w.actor)],
    ['subscribe to request (own)', (w) => subscribe(ctx, w.actor, { request: w.requests.own })],
    ['subscribe to request (other)', (w) => subscribe(ctx, w.actor, { request: w.requests.other })],
    [
      'unsubscribe from request (own)',
      (w) => unsubscribe(ctx, w.actor, { request: w.requests.own }),
    ],
    [
      'unsubscribe from request (other)',
      (w) => unsubscribe(ctx, w.actor, { request: w.requests.other }),
    ],
    // A change that names nobody: the rights to change other people's subscriptions are checked
    // all the same (people are named by a key, which `subscribers.int.test.ts` covers).
    [
      'change request subscribers (own)',
      (w) => changeSubscribers(ctx, w.actor, { request: w.requests.own, add: [], remove: [] }),
    ],
    [
      'change request subscribers (other)',
      (w) => changeSubscribers(ctx, w.actor, { request: w.requests.other, add: [], remove: [] }),
    ],
    [
      'list who can be subscribed to a request (own)',
      (w) => listSubscribable(ctx, w.actor, w.requests.own),
    ],
    [
      'list who can be subscribed to a request (other)',
      (w) => listSubscribable(ctx, w.actor, w.requests.other),
    ],
    [
      'deactivate own account',
      async (w) => {
        await givePassword(w.actor.id);
        await deactivateOwnAccount(ctx, w.actor, OWN_PASSWORD);
      },
    ],
  ];
}

/** The operations by name. */
const OPERATIONS = new Map(listOperations());

/**
 * The operations that only read: while a staff member is signed in as the
 * acting user, they still work, with the user's own rights. Every other
 * operation changes something and is refused then (`signed_in_as`), except
 * the user's own work ({@link OWN_WORK}), so a new operation that changes
 * something is refused unless it's listed here.
 */
const READS: ReadonlySet<string> = new Set([
  'list members (own)',
  'list members (other)',
  'list invitations (own)',
  'list invitations (other)',
  'list invite links (own)',
  'list invite links (other)',
  'list companies',
  'list staff invitations',
  'list staff',
  'view staff settings',
  'list request types',
  'list users',
  'view user',
  'check a user exists',
  'check signing in as a user',
  'list addable companies',
  'view audit log',
  'list the audit log',
  'look up an error reference',
  'list recent errors',
  'view jobs',
  'list job runs',
  'list failed queued jobs',
  'list requests',
  'list requests (own)',
  'list requests (other)',
  'list companies to raise a request for',
  'look up a request (own)',
  'look up a request (other)',
  'view request (own)',
  'view request (other)',
  'list staff to assign',
  'list who can be mentioned in a request (own)',
  'list who can be mentioned in a request (other)',
  'list who can be mentioned in a new request (own)',
  'list who can be mentioned in a new request (other)',
  'count own assigned requests',
  'list who can be subscribed to a request (own)',
  'list who can be subscribed to a request (other)',
]);

/**
 * What a user may still change while a staff member is signed in as them:
 * their own work, which then gets what it gets for the user. Their request
 * work records the staff member (decision 0028); managing request types is
 * staff settings, and refused.
 */
const OWN_WORK: ReadonlySet<string> = new Set([
  'dismiss own MFA recommendation',
  'raise request (own)',
  'raise request (other)',
  'reply to request (own)',
  'reply to request (other)',
  'reply and wait for the company (own)',
  'mark request done (own)',
  'cancel request (own)',
  'reopen request (own)',
  'set request status (own)',
  'set request status (other)',
  'edit request details (own)',
  'edit request details (other)',
  'assign request (own)',
  'assign request (other)',
  'edit request description (own)',
  'edit request description (other)',
  'edit a reply that is not your own (own)',
  'add internal note (own)',
  'add internal note (other)',
  // Subscriptions too; one changed this way goes to the audit log (decision 0025).
  'subscribe to request (own)',
  'subscribe to request (other)',
  'unsubscribe from request (own)',
  'unsubscribe from request (other)',
  'change request subscribers (own)',
  'change request subscribers (other)',
]);

/** What happens when a role tries an operation. */
type Outcome = 'allowed' | 'forbidden' | 'not_found';

/** A refusal that an operation's row doesn't expect, by its code: it fails the matrix. */
type Unexpected = `refused: ${ServiceErrorCode}`;

/**
 * The refusals that still count as allowed, per operation: what its service
 * answers, in the world the matrix builds, once the permission checks have
 * let the actor through. An operation without a row here must succeed when
 * it's allowed, so invalid input, a missing confirmation or a limit fails the
 * matrix instead of passing for "allowed".
 */
const ALSO_ALLOWED: Readonly<Record<string, readonly ServiceErrorCode[]>> = {
  // The company may close a request, but can't cancel one that's done already, as the operation
  // before left it: the status rules answer that the status changed, after the permission passed.
  'cancel request (own)': ['conflict'],
};

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
  'list invitations (other)': 'NNNAAAA',
  // Invite links are shown to whoever sees the members (`members:view`).
  'list invite links (own)': 'FFAAAAA',
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
  'create invite link (other)': 'NNNFFAA',
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
  // Only staff add someone directly, and that's checked before the company is looked up, so a
  // company's users get the same refusal for another company as for their own.
  'add existing user (own)': 'FFFFFAA',
  'add existing user (other)': 'FFFFFAA',
  // A company's name and whether it's active are the staff's (`company:update` and
  // `company:deactivate`: staff Admins and Managers), never its own Admin's.
  'rename company (own)': 'FFFFFAA',
  'rename company (other)': 'NNNFFAA',
  'deactivate company (own)': 'FFFFFAA',
  'reactivate company (own)': 'FFFFFAA',
  'deactivate company (other)': 'NNNFFAA',
  'reactivate company (other)': 'NNNFFAA',
  'list companies': 'FFFAAAA',
  'add company': 'FFFFFAA',
  'invite staff': 'FFFFFFA',
  'create staff invite link': 'FFFFFFA',
  'list staff invitations': 'FFFFFFA',
  'list staff': 'FFFFFFA',
  'view staff settings': 'FFFFFFA',
  // Everyone chooses their own language, time zone and picture, and nobody else's.
  'choose own language': 'AAAAAAA',
  'save own first time zone': 'AAAAAAA',
  'choose own time zone': 'AAAAAAA',
  'choose own picture': 'AAAAAAA',
  // Everyone chooses whether they get emails about requests, for themselves only.
  'turn off own emails about requests': 'AAAAAAA',
  // Everyone chooses how they read a request's activity, for themselves only.
  'choose how own request activity reads': 'AAAAAAA',
  // Everyone dismisses their own MFA recommendation, and nobody else's.
  'dismiss own MFA recommendation': 'AAAAAAA',
  // Everyone's own account, whatever their role.
  'turn off sign-ins by staff': 'AAAAAAA',
  // Sessions and provider accounts are looked up among the user's own: someone else's don't exist.
  "sign out another user's device": 'NNNNNNN',
  "confirm another user's provider account": 'NNNNNNN',
  'rename staff': 'FFFFFFA',
  'set languages': 'FFFFFFA',
  'set default time zone': 'FFFFFFA',
  'set request prefix': 'FFFFFFA',
  // Everyone who reads requests sees the types; only staff Admins change them.
  'list request types': 'AAAAAAA',
  'add request type': 'FFFFFFA',
  'edit request type': 'FFFFFFA',
  'move request type': 'FFFFFFA',
  'archive request type': 'FFFFFFA',
  'restore request type': 'FFFFFFA',
  'change staff role': 'FFFFFFA',
  'remove from staff': 'FFFFFFA',
  'list users': 'FFFAAAA',
  'view user': 'FFFAAAA',
  // The user page's title: whether the user in its URL exists, for the staff who may see users.
  'check a user exists': 'FFFAAAA',
  'check signing in as a user': 'FFFAAAA',
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
  'view jobs': 'FFFFFAA',
  'list job runs': 'FFFFFAA',
  'list failed queued jobs': 'FFFFFAA',
  'pause a job': 'FFFFFFA',
  'resume a job': 'FFFFFFA',
  'run a job now': 'FFFFFFA',
  'retry a failed queued job': 'FFFFFFA',
  'discard a failed queued job': 'FFFFFFA',
  // A user in no company, so Support may too (never a company Admin, see `mayImpersonate`).
  'sign in as a user': 'FFFAFAA',
  // Everyone lists the requests they may see: their companies', or every company's for the staff.
  'list requests': 'AAAAAAA',
  'list requests (own)': 'AAAAAAA',
  'list requests (other)': 'NNNAAAA',
  'list companies to raise a request for': 'AAAAAAA',
  'look up a request (own)': 'AAAAAAA',
  'look up a request (other)': 'NNNAAAA',
  'view request (own)': 'AAAAAAA',
  'view request (other)': 'NNNAAAA',
  // Watchers follow requests and Finance reads them: neither raises one.
  'raise request (own)': 'FAAAFAA',
  'raise request (other)': 'NNNAFAA',
  'reply to request (own)': 'FAAAFAA',
  'reply to request (other)': 'NNNAFAA',
  // Only the staff who work on requests set a request to waiting.
  'reply and wait for the company (own)': 'FFFAFAA',
  // Either side closes a request and reopens it.
  'mark request done (own)': 'FAAAFAA',
  'cancel request (own)': 'FAAAFAA',
  'reopen request (own)': 'FAAAFAA',
  // Every other status, and a request's details, are the staff's.
  'set request status (own)': 'FFFAFAA',
  'set request status (other)': 'NNNAFAA',
  'edit request details (own)': 'FFFAFAA',
  'edit request details (other)': 'NNNAFAA',
  // The staff who work on requests assign them; Finance reads who's assigned, like the company.
  'assign request (own)': 'FFFAFAA',
  'assign request (other)': 'NNNAFAA',
  // The staff's controls and filters name who can be assigned; only the staff get the list.
  'list staff to assign': 'FFFAAAA',
  // A request's description is edited by whoever takes part, and by the staff who work on requests.
  'edit request description (own)': 'FAAAFAA',
  'edit request description (other)': 'NNNAFAA',
  // Past the permission, a reply is only ever its author's to edit.
  'edit a reply that is not your own (own)': 'FNNNFNN',
  // Internal notes are written by the staff who work on requests; Finance reads them.
  'add internal note (own)': 'FFFAFAA',
  'add internal note (other)': 'NNNAFAA',
  // The list at "@" is for whoever may write there: not a Watcher, and not Finance.
  'list who can be mentioned in a request (own)': 'FAAAFAA',
  'list who can be mentioned in a request (other)': 'NNNAFAA',
  'list who can be mentioned in a new request (own)': 'FAAAFAA',
  'list who can be mentioned in a new request (other)': 'NNNAFAA',
  // Everyone counts what's assigned to them (the dashboard): nothing, for whoever can't be.
  'count own assigned requests': 'AAAAAAA',
  // Everyone who reads a request follows it if they like, also who can't reply to it.
  'subscribe to request (own)': 'AAAAAAA',
  'subscribe to request (other)': 'NNNAAAA',
  'unsubscribe from request (own)': 'AAAAAAA',
  'unsubscribe from request (other)': 'NNNAAAA',
  // Other people's subscriptions are for the staff who work on requests, and for a company's
  // Admins among their colleagues; so is the list of who can be subscribed.
  'change request subscribers (own)': 'FFAAFAA',
  'change request subscribers (other)': 'NNNAFAA',
  'list who can be subscribed to a request (own)': 'FFAAFAA',
  'list who can be subscribed to a request (other)': 'NNNAFAA',
  // Everyone may deactivate their own account (each world has other Admins).
  'deactivate own account': 'AAAAAAA',
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
  const outsider = await createUser(db, 'outsider@adiutor.test');
  return {
    actor,
    own,
    other,
    memberships,
    outsider,
    othersSession: await createSession(db, outsider),
    othersAccount: await connectProvider(db, outsider, { confirmed: false }),
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
    failedJobs: {
      retry: await storeQueuedJob(db, 'security-notice'),
      discard: await storeQueuedJob(db, 'security-notice'),
    },
    requests: {
      own: String(
        (await raiseRequest(ctx, ownAdmin, { ...NEW_REQUEST, companyId: own.id })).number,
      ),
      other: String(
        (await raiseRequest(ctx, otherAdmin, { ...NEW_REQUEST, companyId: other.id })).number,
      ),
    },
  };
}

/**
 * Runs an operation and reports whether the permission checks let it through,
 * and if not, how they refused. Any other refusal counts as allowed only when
 * the operation's row in {@link ALSO_ALLOWED} names its code; otherwise it's
 * reported as it is, which fails the matrix.
 *
 * @param name - The operation's name.
 * @param run - The operation.
 * @returns `allowed`, `forbidden` or `not_found`, or `refused: <code>` for a refusal the
 *   operation's row doesn't expect.
 */
async function outcome(name: string, run: () => Promise<unknown>): Promise<Outcome | Unexpected> {
  try {
    await run();
    return 'allowed';
  } catch (error) {
    if (!(error instanceof ServiceError)) {
      throw error;
    }
    if (error.code === 'forbidden' || error.code === 'not_found') {
      return error.code;
    }
    return ALSO_ALLOWED[name]?.includes(error.code) ? 'allowed' : `refused: ${error.code}`;
  }
}

/**
 * Runs an operation and reports how it ended.
 *
 * @param run - The operation.
 * @returns `done`, or the code of the service error it threw.
 */
async function outcomeCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'done';
  } catch (error) {
    if (!(error instanceof ServiceError)) {
      throw error;
    }
    return error.code;
  }
}

describe('authorization matrix', () => {
  it('expects an outcome of every operation for every role', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...OPERATIONS.keys()].sort());
    [...READS, ...OWN_WORK, ...Object.keys(ALSO_ALLOWED)].forEach((name) => {
      expect(OPERATIONS.has(name), name).toBe(true);
    });
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
      await outcome(name, () => defined(OPERATIONS.get(name), `the ${name} operation`)(world)),
    ]);
    const expected = names.map((name) => [name, expectedOutcome(name, role)]);
    expect(Object.fromEntries(results)).toEqual(Object.fromEntries(expected));
  });

  it.each(['client', 'company admin', 'platform admin'] as const)(
    'refuses every change but their own work while a staff member is signed in as a %s, and still reads as them',
    async (role) => {
      const world = await createWorld(role);
      // The sign-in itself, which request work checks again in its transaction.
      await db.insert(impersonation).values({
        staffUserId: world.outsider,
        userId: world.actor.id,
        returnTo: '/dashboard',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      });
      const signedInAs: World = {
        ...world,
        actor: {
          ...world.actor,
          signedInAs: {
            staffId: world.outsider,
            staffName: 'Sam Lee',
            endsAt: new Date(Date.now() + 30 * 60_000),
            returnTo: '/dashboard',
            staffPermissions: ['users:view', 'users:manage', 'audit:view'],
          },
        },
      };
      const names = [...OPERATIONS.keys()];
      const results = await inSequence(names, async (name) => {
        /**
         * Runs the operation with the staff member signed in as the acting user.
         *
         * @returns What the operation returns.
         */
        const run = () => defined(OPERATIONS.get(name), `the ${name} operation`)(signedInAs);
        const asUser = READS.has(name) || OWN_WORK.has(name);
        return [name, asUser ? await outcome(name, run) : await outcomeCode(run)];
      });
      const expected = names.map((name) => [
        name,
        READS.has(name) || OWN_WORK.has(name) ? expectedOutcome(name, role) : 'signed_in_as',
      ]);
      expect(Object.fromEntries(results)).toEqual(Object.fromEntries(expected));
    },
  );

  it('refuses deactivating your own account to the last Admin of the staff or a company', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db, { name: 'Adiutor Tests A' });
    const [soleStaffAdmin, soleCompanyAdmin, client] = [
      await staffActor(db, 'platform_admin'),
      await memberActor(db, company.id, 'admin'),
      await memberActor(db, company.id, 'client'),
    ];
    const results = await inSequence([soleStaffAdmin, soleCompanyAdmin, client], async (actor) => {
      await givePassword(actor.id);
      return outcomeCode(() => deactivateOwnAccount(ctx, actor, OWN_PASSWORD));
    });
    expect(results).toEqual(['conflict', 'conflict', 'done']);
  });
});
