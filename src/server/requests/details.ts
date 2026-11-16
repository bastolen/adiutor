/**
 * @file Changing a request's details: its title, type and priority, which
 * the staff who work on requests can correct. What was asked (the
 * description) and the replies are never changed.
 */
import { eq } from 'drizzle-orm';

import { request, requestEntry } from '@/db/schema';
import type { RequestEntryKind } from '@/lib/requests';
import { requestPrioritySchema, requestTitleSchema, requestTypeSchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { CHANGE_MOMENT, changeRequest, requestToChange } from './change';

/**
 * Changes a request's title, type and priority: whichever differ from what
 * it has. Each change gets its own entry in the request's history, with
 * what it replaced.
 *
 * A change of the type leaves the priority alone unless a new one is given
 * with it: the form suggests the new type's priority, the staff decide. A
 * change of the priority alone doesn't count as activity, since the company
 * doesn't see priorities.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:manage` in the request's company.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.title - The title.
 * @param input.type - The type (`REQUEST_TYPES`).
 * @param input.priority - The priority (`REQUEST_PRIORITIES`).
 * @returns How many of the three changed.
 * @throws {ServiceError} `signed_in_as` while a staff member is signed in as the actor,
 *   `not_found` when the actor may not see the request, `forbidden` without `requests:manage`,
 *   `invalid` when the company is deactivated, `rate_limited` when the actor has changed
 *   requests too often (`RATE_LIMITS.requestChangesPerUser`).
 * @throws {ZodError} When the title, type or priority isn't valid.
 */
export default async function updateRequestDetails(
  ctx: ServiceContext,
  actor: Actor,
  input: { request: string; title: string; type: string; priority: string },
): Promise<{ changed: number }> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:manage');
  const title = requestTitleSchema.parse(input.title);
  const type = requestTypeSchema.parse(input.type);
  const priority = requestPrioritySchema.parse(input.priority);
  await assertRateLimit(ctx, `request-change:user:${actor.id}`, RATE_LIMITS.requestChangesPerUser);

  return changeRequest(ctx, actor, access, 'requests:manage', async (tx, locked) => {
    const changes: { kind: RequestEntryKind; fromValue: string; toValue: string }[] = [];
    if (title !== locked.title) {
      changes.push({ kind: 'title', fromValue: locked.title, toValue: title });
    }
    if (type !== locked.type) {
      changes.push({ kind: 'type', fromValue: locked.type, toValue: type });
    }
    if (priority !== locked.priority) {
      changes.push({ kind: 'priority', fromValue: locked.priority, toValue: priority });
    }
    if (changes.length === 0) {
      return { changed: 0 };
    }
    await tx.insert(requestEntry).values(
      changes.map((change) => ({
        ...change,
        requestId: locked.id,
        authorId: actor.id,
        authorSide: 'staff' as const,
        createdAt: CHANGE_MOMENT,
      })),
    );
    // The company sees the title and the type change, never the priority.
    const seenByCompany = changes.some(({ kind }) => kind !== 'priority');
    await tx
      .update(request)
      .set({ title, type, priority, ...(seenByCompany ? { lastActivityAt: CHANGE_MOMENT } : {}) })
      .where(eq(request.id, locked.id));
    return { changed: changes.length };
  });
}
