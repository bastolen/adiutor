/**
 * @file Ending sessions: the signed-in user's own (one device, or every other
 * device, from the Security page), and everyone's or one user's from the
 * command line after a suspected leak (`pnpm sessions:revoke-all`). Whoever
 * is signed out also loses what skips their second step ({@link endSessionsOf}).
 */
import { and, eq, ne } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { session, user } from '@/db/schema';
import { normalizeEmail } from '@/lib/email-address';

import { assertNotSignedInAs } from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { notFoundError, ServiceError, parseId } from '../errors';
import { forgetAllSecondStepSkips, forgetSecondStepSkips } from './second-step-skips';
import { queueSecurityNotice } from './security-notices';

/**
 * Ends a user's sessions (all of them, or all but one) and forgets what
 * skips their second step: the devices they trusted at the code step and the
 * links in their emails about requests (`forgetSecondStepSkips`). No way of
 * signing someone out leaves a trusted browser or an old email able to get
 * back in, so every path that signs a user out uses it, except signing out
 * one device by ID ({@link revokeOwnSession}) and signing out everyone at
 * once.
 *
 * @param db - Database client or transaction (the change's own).
 * @param userId - The user.
 * @param options - Options.
 * @param options.except - A session to keep, e.g. the one making the request.
 * @returns How many sessions were ended.
 */
export async function endSessionsOf(
  db: DatabaseOrTransaction,
  userId: string,
  { except = null }: { except?: string | null } = {},
): Promise<number> {
  const deleted = await db
    .delete(session)
    .where(and(eq(session.userId, userId), except ? ne(session.id, except) : undefined))
    .returning({ id: session.id });
  await forgetSecondStepSkips(db, userId);
  return deleted.length;
}

/**
 * Signs the user out on one of their other devices and forgets what skips
 * their second step, on this device too: a session doesn't say which trusted
 * device or link is its browser's (see {@link endSessionsOf}).
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @param sessionId - The session to end (unvalidated input is fine).
 * @throws {ServiceError} `not_found` for someone else's or an unknown session,
 *   `invalid` for the current one (use "Sign out" instead).
 */
export async function revokeOwnSession(
  ctx: ServiceContext,
  actor: Actor,
  sessionId: string,
): Promise<void> {
  assertNotSignedInAs(actor);
  const id = parseId(sessionId);
  if (id === actor.sessionId) {
    throw new ServiceError('invalid', 'errors.sessions.currentDevice');
  }
  await ctx.db.transaction(async (tx) => {
    const deleted = await tx
      .delete(session)
      .where(and(eq(session.id, id), eq(session.userId, actor.id)))
      .returning({ id: session.id });
    if (deleted.length === 0) {
      throw notFoundError();
    }
    await forgetSecondStepSkips(tx, actor.id);
    await recordEvent(
      ctx,
      { action: 'session_revoked', actorUserId: actor.id, targetUserId: actor.id },
      tx,
    );
  });
}

/**
 * Signs the user out on every device except this one (see
 * {@link endSessionsOf} for what is forgotten with it).
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @returns How many devices were signed out.
 */
export async function revokeOtherOwnSessions(ctx: ServiceContext, actor: Actor): Promise<number> {
  assertNotSignedInAs(actor);
  return ctx.db.transaction(async (tx) => {
    const count = await endSessionsOf(tx, actor.id, { except: actor.sessionId });
    await recordEvent(
      ctx,
      {
        action: 'sessions_revoked',
        actorUserId: actor.id,
        targetUserId: actor.id,
        details: { others: true, count },
      },
      tx,
    );
    return count;
  });
}

/** What {@link revokeAllSessions} did. */
export interface RevokeAllResult {
  /** How many sessions were ended. */
  count: number;
  /** The user signed out, or `null` when it was everyone. */
  email: string | null;
  /**
   * Whether that user's security email was queued; the next tick of the
   * background jobs sends it (queuing can fail; it's logged).
   */
  noticeQueued: boolean;
}

/**
 * Signs everyone out, or one user, on every device: for the command line
 * after a suspected leak of the database or a session (`pnpm
 * sessions:revoke-all`), so no stolen session keeps working. Trusted devices
 * and request links are forgotten too. Records it in the audit log; one user
 * also gets a security email, queued for the next tick (everyone doesn't: tell
 * them yourself if needed).
 *
 * @param ctx - Service context (the database; there's no request).
 * @param options - Options.
 * @param options.email - Only this user's sessions; everyone's without it.
 * @returns How many sessions were ended, and whose.
 * @throws {ServiceError} `invalid` for an empty address (never "everyone" by
 *   mistake), `not_found` when no account has that address.
 */
export async function revokeAllSessions(
  ctx: Pick<ServiceContext, 'db'>,
  options: { email?: string } = {},
): Promise<RevokeAllResult> {
  const email = normalizeEmail(options.email);
  if (options.email !== undefined && !email) {
    throw new ServiceError('invalid', 'errors.sessions.emailRequired');
  }
  const result = await ctx.db.transaction(async (tx) => {
    const [target] = email
      ? await tx.select({ id: user.id, email: user.email }).from(user).where(eq(user.email, email))
      : [];
    if (email && !target) {
      throw new ServiceError('not_found', 'errors.sessions.noAccount', { email });
    }
    let count: number;
    if (target) {
      count = await endSessionsOf(tx, target.id);
    } else {
      count = (await tx.delete(session).returning({ id: session.id })).length;
      await forgetAllSecondStepSkips(tx);
    }
    await recordEvent(
      ctx,
      {
        action: 'sessions_revoked',
        targetUserId: target?.id ?? null,
        details: target
          ? { commandLine: true, count }
          : { commandLine: true, count, everyone: true },
      },
      tx,
    );
    return { count, email: target?.email ?? null, userId: target?.id ?? null };
  });
  const { userId, ...signedOut } = result;
  const noticeQueued = userId
    ? await queueSecurityNotice(ctx.db, userId, 'signed_out_everywhere')
    : false;
  return { ...signedOut, noticeQueued };
}
