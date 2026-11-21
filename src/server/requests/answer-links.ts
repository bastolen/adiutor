/**
 * @file The links in an email that answer a solution the staff sent
 * (decision 0033): Approve and Deny, without signing in. Each link works
 * once, only for the person the email went to and only for that proposal:
 * the email's job makes one when it sends the email (`createAnswerLink`),
 * the answer page reads it (`readAnswerLink`), and a person's click answers
 * through it (`answerByLink`), as that person, with the same rules as the
 * buttons on the request's page (`answerSolution`).
 */
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { request, requestAnswerLink } from '@/db/schema';
import { formatRequestNumber, type SolutionAnswer } from '@/lib/requests';
import { generateToken, hashToken } from '@/lib/sign-in/tokens';

import { loadActor } from '../actor';
import type { ServiceContext } from '../context';
import { ServiceError } from '../errors';
import getRequestPrefix from '../people/request-prefix';
import { assertRateLimit, ipRateLimitKey, RATE_LIMITS } from '../rate-limit';
import currentProposalEntryId from './proposals';
import answerSolution from './solutions';

/** How long an answer link works, in days, while it's unused and its proposal still waits. */
export const ANSWER_LINK_DAYS = 14;

/**
 * Makes an answer link for someone an email about a proposal goes to. Only
 * the token's hash is stored; the token goes into the email's two links
 * (`/answer/<token>/approve` and `/deny`) and nowhere else.
 *
 * @param db - Database client or transaction.
 * @param link - Who it's for, and what it answers.
 * @param link.requestId - The request.
 * @param link.userId - The person the email goes to.
 * @param link.proposalEntryId - The proposal's status entry.
 * @returns The token.
 */
export async function createAnswerLink(
  db: DatabaseOrTransaction,
  link: { requestId: string; userId: string; proposalEntryId: string },
): Promise<string> {
  const token = generateToken();
  await db.insert(requestAnswerLink).values({
    ...link,
    tokenHash: hashToken(token),
    expiresAt: sql`now() + make_interval(days => ${ANSWER_LINK_DAYS})`,
  });
  return token;
}

/**
 * What an answer link is, for the page it opens:
 *
 * - `usable`: it can still answer;
 * - `used`: it answered (`answer` says how);
 * - `expired`: its time is up;
 * - `overtaken`: the request no longer waits for that proposal (answered in
 *   the app or by someone else, taken back by the staff, closed);
 * - `unavailable`: its person can no longer answer (no longer at the
 *   company, deactivated, or the company is);
 * - `unknown`: no such link.
 *
 * A link that's known names its request, so the page can say which.
 */
export type AnswerLinkView =
  | { state: 'unknown' }
  | {
      state: 'usable' | 'expired' | 'overtaken' | 'unavailable';
      /** The request's number as people see it, e.g. "AD-142". */
      reference: string;
      /** Its number, for its address. */
      number: number;
    }
  | {
      state: 'used';
      reference: string;
      number: number;
      /** How it answered. */
      answer: SolutionAnswer;
    };

/**
 * Finds a link by its token, with what decides whether it can still answer.
 *
 * @param db - Database client or transaction.
 * @param token - The token from the link.
 * @returns The link and its request, or `null` when there's none.
 */
async function findLink(db: DatabaseOrTransaction, token: string) {
  const [found] = await db
    .select({
      id: requestAnswerLink.id,
      requestId: requestAnswerLink.requestId,
      userId: requestAnswerLink.userId,
      proposalEntryId: requestAnswerLink.proposalEntryId,
      usedAt: requestAnswerLink.usedAt,
      answer: requestAnswerLink.answer,
      expired: sql<boolean>`${requestAnswerLink.expiresAt} <= now()`,
      number: request.number,
      status: request.status,
    })
    .from(requestAnswerLink)
    .innerJoin(request, eq(request.id, requestAnswerLink.requestId))
    .where(eq(requestAnswerLink.tokenHash, hashToken(token)));
  return found ?? null;
}

/**
 * Notes a lookup with a link that doesn't exist against the visitor's IP
 * address, so links can't be guessed by trying them.
 *
 * @param ctx - Service context.
 * @throws {ServiceError} `rate_limited` past `RATE_LIMITS.answerLinkMissesPerIp`.
 */
async function noteMiss(ctx: ServiceContext): Promise<void> {
  await assertRateLimit(
    ctx,
    await ipRateLimitKey(ctx, 'answer-link-miss'),
    RATE_LIMITS.answerLinkMissesPerIp,
  );
}

/**
 * Reads what an answer link is, for its page, without using it. A link that
 * doesn't exist counts against the visitor's limit of misses.
 *
 * @param ctx - Service context.
 * @param token - The token from the link.
 * @returns What it is.
 * @throws {ServiceError} `rate_limited` when the visitor has tried too many unknown links.
 */
export async function readAnswerLink(ctx: ServiceContext, token: string): Promise<AnswerLinkView> {
  const found = await findLink(ctx.db, token);
  if (!found) {
    await noteMiss(ctx);
    return { state: 'unknown' };
  }
  const named = {
    reference: formatRequestNumber(await getRequestPrefix(ctx.db), found.number),
    number: found.number,
  };
  if (found.usedAt !== null && found.answer !== null) {
    return { state: 'used', ...named, answer: found.answer };
  }
  if (found.expired) {
    return { state: 'expired', ...named };
  }
  if (
    found.status !== 'proposed' ||
    (await currentProposalEntryId(ctx.db, found.requestId)) !== found.proposalEntryId
  ) {
    return { state: 'overtaken', ...named };
  }
  const person = await loadActor(ctx.db, found.userId);
  if (!person || person.deactivatedAt !== null) {
    return { state: 'unavailable', ...named };
  }
  return { state: 'usable', ...named };
}

/**
 * Answers a solution through a link, as the person the link was made for:
 * the same answer, rules and email as the buttons on the request's page
 * (`answerSolution`), and the link is used in the answer's transaction, so
 * it answers once. A link that can no longer answer changes nothing and says
 * why (see {@link AnswerLinkView}).
 *
 * @param ctx - Service context.
 * @param token - The token from the link.
 * @param answer - `approve` or `deny`.
 * @returns What the link is now: `used` once it answered.
 * @throws {ServiceError} `rate_limited` when the visitor has tried too many unknown links, or
 *   the person has answered too often.
 */
export async function answerByLink(
  ctx: ServiceContext,
  token: string,
  answer: SolutionAnswer,
): Promise<AnswerLinkView> {
  const view = await readAnswerLink(ctx, token);
  if (view.state !== 'usable') {
    return view;
  }
  const found = await findLink(ctx.db, token);
  const person = found ? await loadActor(ctx.db, found.userId) : null;
  if (!found || !person) {
    return { ...view, state: 'unavailable' };
  }
  try {
    await answerSolution(
      ctx,
      person,
      { request: found.requestId, answer },
      {
        /**
         * Notes the link used, in the answer's transaction, while it's still
         * unused and unexpired.
         *
         * @param tx - The answer's transaction.
         * @throws {ServiceError} `conflict` when it was used or expired meanwhile.
         */
        onAnswered: async (tx) => {
          const used = await tx
            .update(requestAnswerLink)
            .set({ usedAt: sql`now()`, answer })
            .where(
              and(
                eq(requestAnswerLink.id, found.id),
                isNull(requestAnswerLink.usedAt),
                gt(requestAnswerLink.expiresAt, sql`now()`),
              ),
            )
            .returning({ id: requestAnswerLink.id });
          // Used or expired in the moment since it was read: the answer isn't saved.
          if (used.length === 0) {
            throw new ServiceError('conflict', 'errors.requests.statusChanged');
          }
        },
      },
    );
  } catch (error) {
    if (!(error instanceof ServiceError) || error.code === 'rate_limited') {
      throw error;
    }
    // The request changed meanwhile, or its person can no longer answer it.
    return { ...view, state: error.code === 'conflict' ? 'overtaken' : 'unavailable' };
  }
  return { state: 'used', reference: view.reference, number: view.number, answer };
}
