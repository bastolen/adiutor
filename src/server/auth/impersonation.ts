/**
 * @file Signing in as a user ("Sign in as"): starting it, working out whom a
 * request acts as while it lasts, ending it, and ending those whose time is
 * up or whose session is gone. A staff member keeps their own session, which
 * an `impersonation` row marks as acting as the user until it ends (see
 * docs/decisions/0017-staff-sign-in-as-users.md). Who may sign in as whom is
 * decided by `mayImpersonate` (`src/lib/authz/impersonation.ts`); while it
 * lasts, services refuse changes (`assertNotSignedInAs`) and the auth guards
 * refuse Better Auth's endpoints (`refuseWhileSignedInAs` in `auth-guards/`).
 */
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import type { Database } from '@/db';
import { auditEvent, impersonation, membership, user } from '@/db/schema';
import {
  IMPERSONATION_MINUTES,
  type ImpersonationVerdict,
  mayImpersonate,
  mayImpersonateAnyone,
} from '@/lib/authz/impersonation';
import { isMfaConfirmedRecently, mustSetUpMfa, mustStepUp } from '@/lib/authz/mfa';
import displayName from '@/lib/display-name';
import { getSafeRedirectPath, isSafeAppRedirect } from '@/lib/redirect';
import { impersonationReasonSchema } from '@/lib/validation';

import { assertNotSignedInAs, assertPermission, getGlobalPermissions } from '../access';
import { type Actor, loadActor } from '../actor';
import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import {
  type ErrorMessageKey,
  forbiddenError,
  notFoundError,
  parseId,
  ServiceError,
} from '../errors';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { queueSecurityNotice } from './security-notices';

/**
 * Why signing in as someone ended, as `impersonation_ended` records it:
 * - `stopped`: the staff member went back to their own account;
 * - `expired`: its {@link IMPERSONATION_MINUTES} were up;
 * - `no_longer_allowed`: the rules no longer allow it (a role changed, an
 *   account was deactivated, the staff member's MFA no longer counts);
 * - `session_ended`: the staff member's own session ended (signed out, or
 *   signed out by someone else).
 */
export type ImpersonationEndReason = 'stopped' | 'expired' | 'no_longer_allowed' | 'session_ended';

/** The message of each refusal by the rules ({@link ImpersonationVerdict}). */
const REFUSAL_MESSAGES: Record<
  Exclude<ImpersonationVerdict, 'allowed' | 'role'>,
  ErrorMessageKey
> = {
  self: 'errors.impersonation.self',
  staff_admin: 'errors.impersonation.staffAdmin',
  staff: 'errors.impersonation.staff',
  company_admin: 'errors.impersonation.companyAdmin',
  deactivated: 'errors.impersonation.deactivated',
  opted_out: 'errors.impersonation.optedOut',
  needs_mfa: 'errors.impersonation.needsMfa',
};

/**
 * Turns a refusal by the rules into the error the staff member sees.
 *
 * @param verdict - The rules' answer, not `allowed`.
 * @returns The error (`forbidden`).
 */
function refusalError(verdict: Exclude<ImpersonationVerdict, 'allowed'>): ServiceError {
  return verdict === 'role'
    ? forbiddenError()
    : new ServiceError('forbidden', REFUSAL_MESSAGES[verdict]);
}

/** What {@link startImpersonation} takes. */
export interface StartImpersonationInput {
  /** The user to sign in as. */
  userId: string;
  /** Why, if the staff member said; empty for none. */
  reason?: string | null;
  /**
   * The page of the app to go back to afterwards (e.g. the user's page with
   * the card's anchor); anything else goes back to the user's page.
   */
  returnTo?: string | null;
}

/**
 * Starts signing in as a user, in the staff member's current session, for
 * {@link IMPERSONATION_MINUTES} minutes.
 *
 * 1. The staff member's role must be one that may sign in as someone, their
 *    account must have strong MFA, and their session must have confirmed
 *    with it in the last 15 minutes (`strongMfaConfirmedUntil`), whatever
 *    their role; then the start counts against their limit
 *    (`RATE_LIMITS.impersonationsPerUser`), since each one emails the user.
 * 2. In one transaction, it locks both users' rows `FOR SHARE` in ID order
 *    (see "Lock order" in docs/security-measures.md), so a role change or
 *    deactivation of either waits or is seen, decides again with those rows
 *    (`mayImpersonate`), marks the session and records
 *    `impersonation_started` with the reason.
 * 3. Once that has committed, the user gets a security email naming the
 *    staff member, without their device or IP address.
 *
 * @param ctx - Service context.
 * @param actor - The staff member, signed in with a session.
 * @param input - The user, the reason and where to go back to afterwards.
 * @returns When it ends by itself.
 * @throws {ServiceError} `forbidden` when the rules refuse it (with the reason) or there's no
 *   session; `confirmation_required` without a recent strong confirmation; `rate_limited`;
 *   `not_found` when the user doesn't exist; `conflict` when the session already signed in as
 *   someone (`signed_in_as` when the request acts as that user); ZodError for a reason that's too
 *   long or has control characters.
 */
export async function startImpersonation(
  ctx: ServiceContext,
  actor: Actor,
  input: StartImpersonationInput,
): Promise<{ expiresAt: Date }> {
  // Not while signed in as someone already: one at a time, and never from the user's view.
  assertNotSignedInAs(actor);
  const userId = parseId(input.userId);
  const reason = impersonationReasonSchema.parse(input.reason ?? '');
  const { sessionId } = actor;
  if (!mayImpersonateAnyone(actor.platformRole) || sessionId === null) {
    throw forbiddenError();
  }
  if (!actor.strongMfa) {
    throw refusalError('needs_mfa');
  }
  if (!isMfaConfirmedRecently(actor.strongMfaConfirmedUntil)) {
    throw new ServiceError('confirmation_required', 'errors.impersonation.confirmationRequired');
  }
  await assertRateLimit(ctx, `impersonation:user:${actor.id}`, RATE_LIMITS.impersonationsPerUser);
  const returnTo = isSafeAppRedirect(input.returnTo)
    ? getSafeRedirectPath(input.returnTo)
    : `/admin/users/${userId}`;

  const started = await ctx.db.transaction(async (tx) => {
    // One statement, in ID order: the staff member and the user.
    const rows = await tx
      .select({
        id: user.id,
        platformRole: user.platformRole,
        deactivatedAt: user.deactivatedAt,
        allowStaffSignIn: user.allowStaffSignIn,
      })
      .from(user)
      .where(inArray(user.id, [...new Set([actor.id, userId])]))
      .orderBy(asc(user.id))
      .for('share');
    const staff = rows.find((row) => row.id === actor.id);
    const target = rows.find((row) => row.id === userId);
    if (!staff || staff.deactivatedAt !== null) {
      throw forbiddenError();
    }
    if (!target) {
      throw notFoundError();
    }
    // Every company they're in, active or not: a company Admin is out of Support's reach either way.
    const companyRoles = await tx
      .select({ role: membership.role })
      .from(membership)
      .where(eq(membership.userId, userId));
    const verdict = mayImpersonate(
      { id: actor.id, platformRole: staff.platformRole ?? null, strongMfa: actor.strongMfa },
      {
        id: userId,
        platformRole: target.platformRole ?? null,
        companyRoles: companyRoles.map((row) => row.role),
        deactivated: target.deactivatedAt !== null,
        allowsStaffSignIn: target.allowStaffSignIn !== false,
      },
    );
    if (verdict !== 'allowed') {
      throw refusalError(verdict);
    }
    const [row] = await tx
      .insert(impersonation)
      .values({
        sessionId,
        staffUserId: actor.id,
        userId,
        reason,
        returnTo,
        expiresAt: sql`now() + make_interval(mins => ${IMPERSONATION_MINUTES})`,
      })
      .onConflictDoNothing({ target: impersonation.sessionId })
      .returning({ expiresAt: impersonation.expiresAt });
    if (!row) {
      throw new ServiceError('conflict', 'errors.impersonation.alreadyStarted');
    }
    await recordEvent(
      ctx,
      {
        action: 'impersonation_started',
        actorUserId: actor.id,
        targetUserId: userId,
        details: { expiresAt: row.expiresAt.toISOString(), ...(reason ? { reason } : {}) },
      },
      tx,
    );
    return row;
  });

  await queueSecurityNotice(ctx.db, userId, 'impersonation_started', { staffUserId: actor.id });
  return { expiresAt: started.expiresAt };
}

/**
 * Says whether the staff member may sign in as a user, and if not why, for
 * the "Sign in as user" card on the user's page: the rules' answer
 * (`mayImpersonate`) with the user as they are now. Starting decides again
 * with the rows locked ({@link startImpersonation}).
 *
 * @param ctx - Service context (only the database is used).
 * @param actor - The staff member; needs `users:view`.
 * @param userId - The user.
 * @returns `allowed`, or the reason it isn't.
 * @throws {ServiceError} `forbidden` without `users:view`; `not_found` for an unknown user.
 */
export async function impersonationVerdictFor(
  ctx: Pick<ServiceContext, 'db'>,
  actor: Actor,
  userId: string,
): Promise<ImpersonationVerdict> {
  assertPermission(getGlobalPermissions(actor), 'users:view');
  const id = parseId(userId);
  const [[target], companyRoles] = await Promise.all([
    ctx.db
      .select({
        platformRole: user.platformRole,
        deactivatedAt: user.deactivatedAt,
        allowStaffSignIn: user.allowStaffSignIn,
      })
      .from(user)
      .where(eq(user.id, id)),
    ctx.db.select({ role: membership.role }).from(membership).where(eq(membership.userId, id)),
  ]);
  if (!target) {
    throw notFoundError();
  }
  return mayImpersonate(
    { id: actor.id, platformRole: actor.platformRole, strongMfa: actor.strongMfa },
    {
      id,
      platformRole: target.platformRole ?? null,
      companyRoles: companyRoles.map((row) => row.role),
      deactivated: target.deactivatedAt !== null,
      allowsStaffSignIn: target.allowStaffSignIn !== false,
    },
  );
}

/** A sign-in as someone that ended, as {@link endImpersonation} returns it. */
export interface EndedImpersonation {
  /** The user the staff member was signed in as. */
  userId: string;
  /** The page of the app to go back to. */
  returnTo: string;
}

/**
 * Ends the sign-in as someone of a session, and records `impersonation_ended`
 * with why, by the staff member, in one transaction. Ending one that has
 * ended already (two tabs at once, or the hourly job first) changes and
 * records nothing.
 *
 * @param ctx - Service context (database and request info).
 * @param sessionId - The staff member's session.
 * @param reason - Why it ends.
 * @returns What ended, or `null` when the session wasn't signed in as anyone.
 */
export async function endImpersonation(
  ctx: Pick<ServiceContext, 'db' | 'requestInfo'>,
  sessionId: string,
  reason: Exclude<ImpersonationEndReason, 'session_ended'>,
): Promise<EndedImpersonation | null> {
  return ctx.db.transaction(async (tx) => {
    const [ended] = await tx
      .delete(impersonation)
      .where(eq(impersonation.sessionId, sessionId))
      .returning({
        staffUserId: impersonation.staffUserId,
        userId: impersonation.userId,
        returnTo: impersonation.returnTo,
      });
    if (!ended) {
      return null;
    }
    await recordEvent(
      ctx,
      {
        action: 'impersonation_ended',
        actorUserId: ended.staffUserId,
        targetUserId: ended.userId,
        details: { reason },
      },
      tx,
    );
    return { userId: ended.userId, returnTo: ended.returnTo };
  });
}

/**
 * Ends every sign-in as someone whose time is up or whose session is gone,
 * for the `finished-sign-ins-as-users` job, recording `impersonation_ended` for each:
 * `expired` at the moment it expired, or `session_ended` now, since when the
 * session went isn't known. Requests end their own as soon as they see it
 * (see `getOptionalActor`); this catches those nobody came back to.
 *
 * @param ctx - Service context (only the database is used).
 * @returns How many ended.
 */
export async function endFinishedImpersonations(ctx: Pick<ServiceContext, 'db'>): Promise<number> {
  return ctx.db.transaction(async (tx) => {
    const ended = await tx
      .delete(impersonation)
      .where(or(lte(impersonation.expiresAt, sql`now()`), isNull(impersonation.sessionId)))
      .returning({
        staffUserId: impersonation.staffUserId,
        userId: impersonation.userId,
        expiresAt: impersonation.expiresAt,
        sessionId: impersonation.sessionId,
      });
    if (ended.length > 0) {
      const now = new Date();
      await tx.insert(auditEvent).values(
        ended.map((row) => {
          const expired = row.expiresAt.getTime() <= now.getTime();
          return {
            action: 'impersonation_ended' as const,
            at: expired ? row.expiresAt : now,
            actorUserId: row.staffUserId,
            targetUserId: row.userId,
            details: { reason: expired ? 'expired' : 'session_ended' },
          };
        }),
      );
    }
    return ended.length;
  });
}

/** A session's sign-in as someone, as {@link findSessionImpersonation} reads it. */
export interface SessionImpersonation {
  /** The user the staff member signed in as. */
  userId: string;
  /** When it ends by itself (it may have passed already). */
  expiresAt: Date;
  /** The page of the app to go back to. */
  returnTo: string;
}

/**
 * Reads whether a session is signed in as someone, whether or not its time
 * is up (so the request that finds it over can end it). Every request reads
 * it alongside the signed-in user (`getOptionalActor`), with the pool, so it
 * adds no wait.
 *
 * @param db - Database client (the pool).
 * @param sessionId - The session.
 * @returns The sign-in as someone, or `null` for an ordinary session.
 */
export async function findSessionImpersonation(
  db: Database,
  sessionId: string,
): Promise<SessionImpersonation | null> {
  const [found] = await db
    .select({
      userId: impersonation.userId,
      expiresAt: impersonation.expiresAt,
      returnTo: impersonation.returnTo,
    })
    .from(impersonation)
    .where(eq(impersonation.sessionId, sessionId));
  return found ?? null;
}

/**
 * What a request signed in as someone acts as ({@link actorSignedInAs}): the
 * user, or an end because it's over.
 */
export type SignedInAsOutcome =
  { actor: Actor } | { end: Extract<ImpersonationEndReason, 'expired' | 'no_longer_allowed'> };

/**
 * Works out whom a request signed in as someone acts as, checking again
 * with what the request just loaded (both people's roles, their accounts,
 * the staff member's MFA), so a demotion, a deactivation or a lost second
 * step ends it at once:
 *
 * - its time is up: it ends (`expired`);
 * - `mayImpersonate` no longer allows it, or the staff member's session no
 *   longer counts as MFA (`mustStepUp`, `mustSetUpMfa`): it ends
 *   (`no_longer_allowed`);
 * - otherwise: the user, loaded without a session (the session is the staff
 *   member's), with `signedInAs` set.
 *
 * The caller ends it after the response and goes on as the staff member.
 *
 * @param db - Database client (the pool).
 * @param staff - The staff member, as their request loaded them.
 * @param found - The session's sign-in as someone.
 * @param now - The current time.
 * @returns The user as the actor, or why it ends.
 */
export async function actorSignedInAs(
  db: Database,
  staff: Actor,
  found: SessionImpersonation,
  now: Date = new Date(),
): Promise<SignedInAsOutcome> {
  if (found.expiresAt.getTime() <= now.getTime()) {
    return { end: 'expired' };
  }
  if (mustStepUp(staff) || mustSetUpMfa(staff)) {
    return { end: 'no_longer_allowed' };
  }
  const target = await loadActor(db, found.userId);
  const verdict = target
    ? mayImpersonate(
        { id: staff.id, platformRole: staff.platformRole, strongMfa: staff.strongMfa },
        {
          id: target.id,
          platformRole: target.platformRole,
          companyRoles: Object.values(target.memberships),
          deactivated: target.deactivatedAt !== null,
          allowsStaffSignIn: target.allowStaffSignIn,
        },
      )
    : 'deactivated';
  if (!target || verdict !== 'allowed') {
    return { end: 'no_longer_allowed' };
  }
  return {
    actor: {
      ...target,
      signedInAs: {
        staffId: staff.id,
        staffName: displayName(staff),
        endsAt: found.expiresAt,
        returnTo: found.returnTo,
        staffPermissions: [...getGlobalPermissions(staff)],
      },
    },
  };
}

/**
 * Turns sign-ins by staff on or off for the user's own account, from their
 * Security page, and records it (`staff_sign_in_turned_off` or
 * `staff_sign_in_turned_on`). Turning it off ends a sign-in as them that's
 * under way at the staff member's next request (`actorSignedInAs`), and
 * starting one waits for this change or sees it (both lock the user's row).
 * Choosing what's already set changes and records nothing.
 *
 * @param ctx - Service context.
 * @param actor - The user.
 * @param allowed - Whether staff may sign in as them.
 * @returns Whether anything changed.
 * @throws {ServiceError} `signed_in_as` while a staff member is signed in as them.
 */
export async function setStaffSignInAllowed(
  ctx: ServiceContext,
  actor: Actor,
  allowed: boolean,
): Promise<boolean> {
  assertNotSignedInAs(actor);
  return ctx.db.transaction(async (tx) => {
    const [changed] = await tx
      .update(user)
      .set({ allowStaffSignIn: allowed })
      .where(
        and(
          eq(user.id, actor.id),
          // Only when it changes, so choosing the same again records nothing. A row from before the
          // setting existed (`null`) counts as on.
          allowed
            ? eq(user.allowStaffSignIn, false)
            : or(isNull(user.allowStaffSignIn), eq(user.allowStaffSignIn, true)),
        ),
      )
      .returning({ id: user.id });
    if (!changed) {
      return false;
    }
    await recordEvent(
      ctx,
      {
        action: allowed ? 'staff_sign_in_turned_on' : 'staff_sign_in_turned_off',
        actorUserId: actor.id,
        targetUserId: actor.id,
      },
      tx,
    );
    return true;
  });
}
