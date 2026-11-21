/**
 * @file Raising a request: someone at a company asks the staff for
 * something, or the staff raise it for the company.
 */
import { sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';
import { request, requestCounter } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { requestSide, WRITTEN_TEXT_FORMAT } from '@/lib/requests';
import {
  requestCompanySchema,
  requestDescriptionSchema,
  requestPrioritySchema,
  requestTitleSchema,
} from '@/lib/validation';

import { assertPermission, getCompanyAccess } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { companyDeactivatedError } from '../errors';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { actingUserId, signedInAsWork } from '../signed-in-as';
import { assertStillMayChange } from './change';
import { storeMentions } from './mentions';
import { typeToGive } from './types';

/**
 * Takes the next request number: one more than the last, in the raising
 * transaction, so two requests never share a number and a request that
 * isn't raised after all uses none up. The first request makes the counter's
 * row. Whoever takes a number holds the row until their transaction ends, so
 * it's taken right before the request is stored.
 *
 * It also reads the database's clock once the number is taken, in the same
 * statement: the moment the request is raised. Not `now()`, which is when
 * the transaction started, before it waited for its number: a request would
 * then seem raised before the one numbered just before it. One reading for
 * the request's two times, which each would otherwise read for itself.
 *
 * @param tx - The raising transaction.
 * @returns The number, and the moment it was taken.
 */
async function nextRequestNumber(
  tx: DatabaseTransaction,
): Promise<{ number: number; takenAt: Date }> {
  const counted = await tx
    .insert(requestCounter)
    .values({ lastNumber: 1 })
    .onConflictDoUpdate({
      target: requestCounter.singleton,
      set: { lastNumber: sql`${requestCounter.lastNumber} + 1` },
    })
    .returning({
      number: requestCounter.lastNumber,
      takenAt: sql`clock_timestamp()`.mapWith(request.createdAt),
    });
  return firstRow(counted, 'the request counter');
}

/**
 * Raises a request in a company. Whoever raises it chooses its type, which
 * sets its priority; only the staff who work on requests can choose another
 * priority, and from anyone else a priority is ignored.
 *
 * The transaction first checks the actor's right and the company again as
 * they are by then (`assertStillMayChange`), so someone who lost the right
 * while the request was under way raises nothing. A staff member signed in
 * as the actor may raise it for them, and is recorded (decision 0028).
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:contribute` in the company.
 * @param input - Form input.
 * @param input.companyId - The company's ID or URL name; empty when none was chosen.
 * @param input.title - What it's about, in one line.
 * @param input.description - What's asked.
 * @param input.type - What kind of request it is: a type's key, which must exist and not be
 *   archived.
 * @param input.priority - A priority, from the staff (`REQUEST_PRIORITIES`); empty for the type's.
 * @returns The new request's ID and number.
 * @throws {ServiceError} `not_found` when the actor may not see the company, `forbidden`
 *   without `requests:contribute`, `invalid` when the company is deactivated or the type can't
 *   be chosen (`errors.requestTypes.unavailable`), `rate_limited` when whoever acts has raised
 *   too many requests (`RATE_LIMITS.requestsPerUser`), `signed_in_as` when the sign-in as the
 *   actor ended meanwhile.
 * @throws {ZodError} When no company was chosen (asked first, like the form does), or the
 *   title, description, type or priority isn't valid.
 */
export default async function raiseRequest(
  ctx: ServiceContext,
  actor: Actor,
  input: { companyId: string; title: string; description: string; type: string; priority?: string },
): Promise<{ id: string; number: number }> {
  // A company that wasn't chosen is a field to fill in, not a page that doesn't exist.
  const companyRef = requestCompanySchema.parse(input.companyId);
  const { company, permissions } = await getCompanyAccess(ctx.db, actor, companyRef);
  assertPermission(permissions, 'requests:contribute');
  if (company.deactivatedAt) {
    throw companyDeactivatedError();
  }
  const title = requestTitleSchema.parse(input.title);
  const description = requestDescriptionSchema.parse(input.description);
  const { key: type, startingPriority } = await typeToGive(ctx.db, input.type);
  const priority =
    permissions.has('requests:manage') && input.priority
      ? requestPrioritySchema.parse(input.priority)
      : startingPriority;
  await assertRateLimit(ctx, `request:user:${actingUserId(actor)}`, RATE_LIMITS.requestsPerUser);

  const work = signedInAsWork(actor);

  return ctx.db.transaction(async (tx) => {
    await assertStillMayChange(tx, actor, company.id, 'requests:contribute');
    const { number, takenAt } = await nextRequestNumber(tx);
    const raised = firstRow(
      await tx
        .insert(request)
        .values({
          number,
          companyId: company.id,
          title,
          description,
          descriptionFormat: WRITTEN_TEXT_FORMAT,
          type,
          priority,
          createdBy: actor.id,
          createdBySide: requestSide(permissions),
          createdSignedInAs: work.signedInAs,
          createdSignedInAsStaffId: work.signedInAsStaffId,
          // Raised and last active at one moment: when its number was taken.
          createdAt: takenAt,
          lastActivityAt: takenAt,
        })
        .returning({ id: request.id, number: request.number }),
      'the new request',
    );
    // The people the description mentions, once the request it belongs to is there.
    await storeMentions(tx, actor, {
      companyId: company.id,
      requestId: raised.id,
      entryId: null,
      written: description,
    });
    return raised;
  });
}
