/**
 * @file The company's answer to a solution the staff sent (decision 0033):
 * the staff send a reply as the solution, which makes the request wait for
 * the company's approval (`proposed`, through `replyToRequest`); someone at
 * the company who takes part approves it, which closes the request, or
 * denies it, with an optional reason, which puts it back in progress.
 */
import type { DatabaseTransaction } from '@/db';
import { requestEntry } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { appUrl } from '@/lib/env';
import {
  mayAnswerSolution,
  requestSide,
  type RequestStatus,
  SOLUTION_ANSWERS,
  type SolutionAnswer,
  statusAfterAnswer,
  WRITTEN_TEXT_FORMAT,
} from '@/lib/requests';
import { requestReplySchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { forbiddenError, ServiceError } from '../errors';
import { signedInAsWork } from '../signed-in-as';
import {
  assertChangeLimit,
  CHANGE_MOMENT,
  changeRequest,
  recordStatusChange,
  requestToChange,
} from './change';
import { storeMentions } from './mentions';
import withoutStaffPageLinks from './staff-links';
import { subscribeAutomatically } from './subscribers';
import { type RequestNews, tellPeopleOnRequest } from './updates';

/**
 * Approves or denies the solution a request waits on, for an Admin or a
 * Client of its company (`mayAnswerSolution`). Approving makes it Done;
 * denying puts it back In progress, and a reason, when given, is stored as
 * their reply right before the change, so the history reads: the reason,
 * then the answer. The people on the request hear of it in one email.
 *
 * The answer is checked again on the request as it's locked: when it no
 * longer waits for an approval (answered meanwhile, withdrawn by the staff,
 * cancelled), nothing changes and the caller is told the status changed.
 * `onAnswered` runs in the same transaction, after the answer: the answer
 * link of an email uses it to note itself used, so a link is used exactly
 * when its answer is saved.
 *
 * @param ctx - Service context.
 * @param actor - The acting user: someone at the company who takes part.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.answer - `approve` or `deny`.
 * @param input.body - Why it isn't solved, for a denial; empty or left out for none.
 * @param options - Options.
 * @param options.onAnswered - Runs in the answer's transaction, once it's saved.
 * @returns The status the request has now.
 * @throws {ServiceError} `not_found` when the actor may not see the request, `forbidden` when
 *   they may not answer (a Watcher, the staff) or the answer isn't one, `invalid` when the
 *   company is deactivated, `rate_limited` past `RATE_LIMITS.requestChangesPerUser`,
 *   `conflict` when the request no longer waits for an approval
 *   (`errors.requests.statusChanged`), `signed_in_as` when a sign-in as the actor ended
 *   meanwhile.
 * @throws {ZodError} When the reason isn't valid.
 */
export default async function answerSolution(
  ctx: ServiceContext,
  actor: Actor,
  input: { request: string; answer: string; body?: string },
  options: { onAnswered?: (tx: DatabaseTransaction) => Promise<void> } = {},
): Promise<{ status: RequestStatus }> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:contribute');
  const { permissions } = access;
  const answer = SOLUTION_ANSWERS.find((value) => value === input.answer);
  // Watchers and the staff never answer; a status other than `proposed` is checked when locked.
  if (!answer || !mayAnswerSolution(permissions, 'proposed')) {
    throw forbiddenError();
  }
  const written =
    answer === 'deny' && input.body?.trim() ? requestReplySchema.parse(input.body) : null;
  await assertChangeLimit(ctx, actor);
  // A reply like any other, without links to the staff's pages. Past the limit, as reading the
  // text costs time.
  const reason = written === null ? null : withoutStaffPageLinks(written, appUrl);

  const side = requestSide(permissions);
  return changeRequest(ctx, actor, access, 'requests:contribute', async (tx, locked) => {
    if (!mayAnswerSolution(permissions, locked.status)) {
      throw new ServiceError('conflict', 'errors.requests.statusChanged');
    }
    const news: RequestNews[] = [];
    let mentioned: string[] = [];
    if (reason !== null) {
      const reply = firstRow(
        await tx
          .insert(requestEntry)
          .values({
            requestId: locked.id,
            kind: 'comment',
            authorId: actor.id,
            authorSide: side,
            ...signedInAsWork(actor),
            body: reason,
            bodyFormat: WRITTEN_TEXT_FORMAT,
            createdAt: CHANGE_MOMENT,
          })
          .returning({ id: requestEntry.id }),
        'the reason',
      );
      await subscribeAutomatically(tx, locked.id, [actor.id]);
      mentioned = await storeMentions(tx, actor, {
        companyId: locked.companyId,
        requestId: locked.id,
        entryId: reply.id,
        written: reason,
      });
      news.push({ event: 'reply', entryId: reply.id });
    }
    const status = statusAfterAnswer(answer satisfies SolutionAnswer);
    const changed = await recordStatusChange(tx, locked, status, actor, side);
    news.push({ event: 'status', entryId: changed });
    await options.onAnswered?.(tx);
    // The people on the request hear of the answer, and the reason with it, in one email.
    await tellPeopleOnRequest(tx, { request: locked, actorId: actor.id }, news, mentioned);
    return { status };
  });
}
