/**
 * @file Changing a request's details: its title, type and priority, which
 * the staff who work on requests can correct. What was asked (the
 * description) and the replies are never changed.
 */
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { request, requestEntry } from '@/db/schema';
import { requestPrioritySchema, requestTitleSchema, requestTypeSchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { ServiceError } from '../errors';
import { signedInAsWork } from '../signed-in-as';
import type { RequestRow } from './access';
import { assertChangeLimit, CHANGE_MOMENT, changeRequest, requestToChange } from './change';
import { typeToGive } from './types';

/** The details the staff can change, in the order their changes show in the history. */
const DETAILS = ['title', 'type', 'priority'] as const;

/** One of the details the staff can change. */
type Detail = (typeof DETAILS)[number];

/** A request's details as they're stored. */
type DetailValues = Pick<RequestRow, Detail>;

/** What an editor did to one detail. */
interface DetailEdit<T> {
  /** The value the form started from, which the editor saw. */
  was: string;
  /** The value they chose instead. */
  to: T;
}

/**
 * Reads what an editor did to one detail: nothing, when the form sends back
 * what it started from, or the value they chose. The two are compared as
 * they'd be stored, so spaces around a title aren't a change.
 *
 * Only a value the editor chose is checked against the detail's rules. What
 * they left alone isn't theirs to answer for, and stays as it's stored.
 *
 * @param schema - The detail's rules.
 * @param posted - The value the form sent.
 * @param was - The value the form started from.
 * @returns The edit, or `null` when the editor left the detail alone.
 * @throws {ZodError} When the value they chose isn't valid.
 */
function editOf<T extends string>(
  schema: z.ZodType<T>,
  posted: string,
  was: string,
): DetailEdit<T> | null {
  const started = was.trim();
  if (posted.trim() === started) {
    return null;
  }
  return { was: started, to: schema.parse(posted) };
}

/**
 * Changes a request's title, type and priority: the ones its editor changed
 * in the form. Each change gets its own entry in the request's history,
 * with what it replaced.
 *
 * The form sends all three, and the values it started from (`was`). A
 * detail the editor left as the form showed it stays as it's stored, also
 * when a colleague changed it meanwhile: the editor's page was behind, they
 * didn't decide anything about it. A detail the editor did change is saved
 * only while it's still what they saw. When a colleague changed it to
 * something else meanwhile, nothing is saved, and the editor is told to
 * look again (`errors.requests.detailsChanged`) rather than undo that
 * change unseen; when the colleague made the same change, there's nothing
 * left to do.
 *
 * A change of the type leaves the priority alone unless a new one is given
 * with it: the form suggests the new type's priority, which then counts as
 * the editor's choice. A change of the priority alone doesn't count as
 * activity, since the company doesn't see priorities.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:manage` in the request's company.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.title - The title.
 * @param input.type - The type's key; a new one must exist and not be archived.
 * @param input.priority - The priority (`REQUEST_PRIORITIES`).
 * @param input.was - The details the form started from, which its editor saw.
 * @param input.was.title - The title it started from.
 * @param input.was.type - The type it started from.
 * @param input.was.priority - The priority it started from.
 * @returns How many of the three changed.
 * @throws {ServiceError} `signed_in_as` when the sign-in as the actor ended meanwhile,
 *   `not_found` when the actor may not see the request, `forbidden` without `requests:manage`,
 *   `invalid` when the company is deactivated or a new type can't be chosen
 *   (`errors.requestTypes.unavailable`), `rate_limited` when the actor has changed
 *   requests too often (`RATE_LIMITS.requestChangesPerUser`), `conflict` when a detail the
 *   editor changed was changed to something else meanwhile.
 * @throws {ZodError} When a title, type or priority the editor chose isn't valid.
 */
export default async function updateRequestDetails(
  ctx: ServiceContext,
  actor: Actor,
  input: {
    request: string;
    title: string;
    type: string;
    priority: string;
    was: { title: string; type: string; priority: string };
  },
): Promise<{ changed: number }> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:manage');
  const edits: { [K in Detail]: DetailEdit<DetailValues[K]> | null } = {
    title: editOf(requestTitleSchema, input.title, input.was.title),
    type: editOf(requestTypeSchema, input.type, input.was.type),
    priority: editOf(requestPrioritySchema, input.priority, input.was.priority),
  };
  // A type the editor picked must still be one to pick; the one a request has stays even archived.
  if (edits.type) {
    await typeToGive(ctx.db, edits.type.to);
  }
  await assertChangeLimit(ctx, actor);

  return changeRequest(ctx, actor, access, 'requests:manage', async (tx, locked) => {
    const values: Partial<DetailValues> = {};
    const changes: { kind: Detail; fromValue: string; toValue: string }[] = [];
    /**
     * Takes the editor's change of one detail, if there's one left to make.
     *
     * @param kind - The detail.
     * @throws {ServiceError} `conflict` when someone changed it to something else meanwhile.
     */
    const take = <K extends Detail>(kind: K): void => {
      const edit = edits[kind];
      // Left alone by the editor, or already what they chose: a colleague did the same.
      if (!edit || locked[kind] === edit.to) {
        return;
      }
      // Not what the editor saw anymore: saving theirs would undo a change they never saw.
      if (locked[kind] !== edit.was) {
        throw new ServiceError('conflict', 'errors.requests.detailsChanged');
      }
      values[kind] = edit.to;
      changes.push({ kind, fromValue: locked[kind], toValue: edit.to });
    };
    DETAILS.forEach((kind) => take(kind));
    if (changes.length === 0) {
      return { changed: 0 };
    }
    await tx.insert(requestEntry).values(
      changes.map((change) => ({
        ...change,
        requestId: locked.id,
        authorId: actor.id,
        authorSide: 'staff' as const,
        ...signedInAsWork(actor),
        createdAt: CHANGE_MOMENT,
      })),
    );
    // The company sees the title and the type change, never the priority.
    const seenByCompany = changes.some(({ kind }) => kind !== 'priority');
    await tx
      .update(request)
      .set({ ...values, ...(seenByCompany ? { lastActivityAt: CHANGE_MOMENT } : {}) })
      .where(eq(request.id, locked.id));
    return { changed: changes.length };
  });
}
