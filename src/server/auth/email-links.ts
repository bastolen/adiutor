/**
 * @file Looks up a sign-in link for the page sign-in emails link to
 * (`/auth/email-link`), without using it, so the page can say which account
 * it signs in to before the user continues (someone could send you a link to
 * their own account, to sign you into it).
 */
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { user, verification } from '@/db/schema';
import { emailLinkVerificationIdentifier } from '@/lib/sign-in/tokens';

import type { ServiceContext } from '../context';
import {
  hitRateLimit,
  RATE_LIMITS,
  releaseRateLimitHit,
  tooManyAttemptsError,
} from '../rate-limit';

/** The account a sign-in link signs in to, as the page shows it. */
export interface EmailLinkPreview {
  /** The account's ID, to compare with whoever is signed in (not for the page to show). */
  userId: string;
  /** Its name; may be empty. */
  name: string;
  /**
   * Its email address, in full: users can't choose or change it, so unlike
   * the name it can't be made to look like someone else's.
   */
  email: string;
}

/** What Better Auth's magic-link plugin stores in a link's verification row. */
const linkRecordSchema = z.object({ type: z.literal('magic-link'), email: z.string() });

/**
 * Reads the address a stored link was made for.
 *
 * @param value - The verification row's value (JSON).
 * @returns The address, or `null` when the value isn't a sign-in link's.
 */
function linkEmail(value: string): string | null {
  try {
    const record = linkRecordSchema.safeParse(JSON.parse(value));
    return record.success ? record.data.email : null;
  } catch {
    return null;
  }
}

/**
 * Finds the account a sign-in link signs in to, without using the link.
 * Links that expired, were used, were never valid, or belong to a
 * deactivated account all give `null` (Better Auth refuses them as well).
 * Each lookup counts against a limit per IP address before it's made, and is
 * given back when the link is found, so only links that can't be used count.
 *
 * @param ctx - Service context.
 * @param token - The token from the link (unvalidated input is fine).
 * @returns The account, or `null` when the link can't be used.
 * @throws {ServiceError} `rate_limited` after too many links from this IP address that couldn't be
 *   used.
 */
export async function getEmailLinkPreview(
  ctx: ServiceContext,
  token: string,
): Promise<EmailLinkPreview | null> {
  const request = ctx.requestInfo ? await ctx.requestInfo() : null;
  const key = `email-link-miss:ip:${request?.ip ?? 'unknown'}`;
  const { allowed, retryAfterSeconds } = await hitRateLimit(
    ctx,
    key,
    RATE_LIMITS.emailLinkMissesPerIp,
  );
  if (!allowed) {
    throw tooManyAttemptsError(retryAfterSeconds);
  }

  const [link] = await ctx.db
    .select({ value: verification.value })
    .from(verification)
    .where(
      and(
        eq(verification.identifier, emailLinkVerificationIdentifier(token)),
        gt(verification.expiresAt, sql`now()`),
      ),
    );
  const email = link ? linkEmail(link.value) : null;
  const [found] = email
    ? await ctx.db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        // Better Auth stores and finds addresses in lower case.
        .where(and(eq(user.email, email.toLowerCase()), isNull(user.deactivatedAt)))
    : [];
  if (!found) {
    return null;
  }

  await releaseRateLimitHit(ctx, key);
  return { userId: found.id, name: found.name, email: found.email };
}
