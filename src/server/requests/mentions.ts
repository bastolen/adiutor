/**
 * @file Mentions in a request's text: who may be mentioned, the key that
 * stands for them while a text is written, and the rows that say who a
 * stored text mentions (`request_mention`).
 *
 * Who may be mentioned follows what the writer may know. The staff can
 * mention everyone at the request's company and every staff member who
 * reads requests. Someone at the company can mention their colleagues and
 * the staff members whose names the request already shows them: who raised
 * it, replied to it, changed it, is assigned to it or was assigned. They
 * learn nothing else about who is on the staff. Nobody mentions themselves,
 * a deactivated account, or someone without a name to show.
 *
 * A text never holds a user ID. While it's written, a person is named by a
 * key that's only valid in the request's company ({@link mentionKey}); once
 * it's stored, by the ID of the mention's row.
 */
import { createHmac } from 'node:crypto';

import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';

import type { Database, DatabaseTransaction } from '@/db';
import {
  membership,
  request,
  requestParticipant,
  requestEntry,
  requestMention,
  user,
} from '@/db/schema';
import { getStaffPermissionsInCompanies } from '@/lib/authz/permissions';
import { visibleName } from '@/lib/display-name';
import { env } from '@/lib/env';
import {
  MAX_MENTIONS_PER_TEXT,
  MENTION_KEY_LENGTH,
  type RequestSide,
  storeWrittenMentions,
  writtenMentionKeys,
} from '@/lib/requests';

import { assertPermission, getCompanyAccess } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { getRequestAccess, READING_STAFF_ROLES } from './access';
import { subscribeAutomatically } from './subscribers';

/** Someone who can be mentioned, as the list at "@" shows them. */
export interface MentionablePerson {
  /**
   * What stands for them in a text that's being written. It's only valid in
   * the company it was made for, and says nothing about who they are.
   */
  key: string;
  /** Their name. */
  name: string;
  /** Whether they're on the staff's side; the list gives them the staff's label. */
  staff: boolean;
}

/** Someone who may be mentioned, as the services know them. */
interface Mentionable {
  /** Their user ID, which never leaves the server. */
  id: string;
  /** Their name. */
  name: string;
  /** The side a mention of them is on. */
  side: RequestSide;
}

/** Where a text is, or will be: its company, and its request once there is one. */
interface TextPlace {
  /** The company's ID. */
  companyId: string;
  /** The request's ID; `null` for a request that's still being written. */
  requestId: string | null;
}

/**
 * The secret the keys are made with: its own, worked out from the app's
 * secret once, so a key is never a signature of anything else.
 */
let keySecret: Buffer | undefined;

/**
 * The key that stands for a person in a text that's being written in a
 * company. It's the same every time, so a text that was kept in the browser
 * still names them, and it can't be turned back into who they are or used in
 * another company. Nothing is stored for it: the server makes the keys of
 * the people who may be mentioned again and compares.
 *
 * @param companyId - The company the text is written in.
 * @param userId - The person.
 * @returns Their key there.
 */
export function mentionKey(companyId: string, userId: string): string {
  keySecret ??= createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update('adiutor mention keys')
    .digest();
  return createHmac('sha256', keySecret)
    .update(`${companyId}:${userId}`)
    .digest('base64url')
    .slice(0, MENTION_KEY_LENGTH);
}

/**
 * Finds who the actor may mention in a text somewhere (see the file
 * comment). One query after another: it also runs inside a change's
 * transaction.
 *
 * @param db - Database client, or the change's transaction.
 * @param actor - Whoever writes.
 * @param place - The text's company, and its request if there is one.
 * @returns The people, in no order.
 */
async function mentionable(
  db: Database | DatabaseTransaction,
  actor: Actor,
  place: TextPlace,
): Promise<Mentionable[]> {
  const active = isNull(user.deactivatedAt);
  const readsRequests = inArray(user.platformRole, READING_STAFF_ROLES);
  const person = { id: user.id, name: user.name };
  const colleagues = await db
    .select(person)
    .from(membership)
    .innerJoin(user, eq(membership.userId, user.id))
    .where(and(eq(membership.companyId, place.companyId), active));

  let staff: { id: string; name: string }[] = [];
  if (getStaffPermissionsInCompanies(actor).has('requests:view-internal')) {
    staff = await db.select(person).from(user).where(and(readsRequests, active));
  } else if (place.requestId !== null) {
    // The staff members the request shows someone at the company by name. A change of
    // priority is the one entry they don't see.
    const entries = eq(requestEntry.requestId, place.requestId);
    staff = await db
      .select(person)
      .from(user)
      .where(
        and(
          readsRequests,
          active,
          or(
            inArray(
              user.id,
              db
                .select({ id: requestEntry.authorId })
                .from(requestEntry)
                .where(
                  and(
                    entries,
                    eq(requestEntry.authorSide, 'staff'),
                    ne(requestEntry.kind, 'priority'),
                    isNotNull(requestEntry.authorId),
                  ),
                ),
            ),
            inArray(
              user.id,
              db
                .select({ id: requestEntry.subjectUserId })
                .from(requestEntry)
                .where(and(entries, isNotNull(requestEntry.subjectUserId))),
            ),
            inArray(
              user.id,
              db
                .select({ id: requestParticipant.userId })
                .from(requestParticipant)
                .where(
                  and(
                    eq(requestParticipant.requestId, place.requestId),
                    eq(requestParticipant.role, 'assignee'),
                  ),
                ),
            ),
            inArray(
              user.id,
              db
                .select({ id: request.createdBy })
                .from(request)
                .where(
                  and(
                    eq(request.id, place.requestId),
                    eq(request.createdBySide, 'staff'),
                    isNotNull(request.createdBy),
                  ),
                ),
            ),
          ),
        ),
      );
  }

  // Someone on the staff who is also in the company is mentioned as the staff member they are.
  const people = new Map<string, Mentionable>();
  const sides: [typeof staff, RequestSide][] = [
    [colleagues, 'company'],
    [staff, 'staff'],
  ];
  sides.forEach(([found, side]) => {
    found.forEach(({ id, name }) => {
      const shown = visibleName(name);
      if (shown !== null && id !== actor.id) {
        people.set(id, { id, name: shown, side });
      }
    });
  });
  return [...people.values()];
}

/**
 * Lists who the actor can mention in a text: a reply to a request, or the
 * description of a new request for a company. For the list at "@": names,
 * the staff's label and a key each, by name; never an ID or an address.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:contribute` in the company.
 * @param where - The request the text is a reply to (its number or ID), or
 *   the company a new request is raised for (its ID or URL name).
 * @returns The people; nobody for a deactivated company, where nothing is written.
 * @throws {ServiceError} `not_found` when the actor may not see the request or
 *   the company, `forbidden` without `requests:contribute`.
 */
export async function listMentionable(
  ctx: ServiceContext,
  actor: Actor,
  where: { request: string } | { company: string },
): Promise<MentionablePerson[]> {
  let requestId: string | null = null;
  let access;
  if ('request' in where) {
    const found = await getRequestAccess(ctx.db, actor, where.request);
    requestId = found.request.id;
    access = found;
  } else {
    access = await getCompanyAccess(ctx.db, actor, where.company);
  }
  const { company, permissions } = access;
  assertPermission(permissions, 'requests:contribute');
  if (company.deactivatedAt) {
    return [];
  }
  const people = await mentionable(ctx.db, actor, { companyId: company.id, requestId });
  return people
    .map(({ id, name, side }) => ({
      key: mentionKey(company.id, id),
      name,
      staff: side === 'staff',
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.key.localeCompare(b.key),
    );
}

/**
 * Stores who a text that was just written mentions, and points the text's
 * markers at those rows. Called in the transaction that stored the text,
 * right after it: the text's row comes first, since a mention belongs to it.
 *
 * Whoever is mentioned is subscribed to the request (`subscribeAutomatically`).
 *
 * Only the markers of people the writer may mention there count, and the
 * first {@link MAX_MENTIONS_PER_TEXT} people of those; every other marker
 * stays in the text as it was written, where it shows as its link's text. A
 * text without a marker that counts isn't touched.
 *
 * @param tx - The transaction that stored the text.
 * @param actor - Whoever wrote it.
 * @param text - The text as it was stored, and where it is.
 * @param text.companyId - The request's company.
 * @param text.requestId - The request.
 * @param text.entryId - The reply the text is; `null` for the request's description.
 * @param text.written - The text.
 */
export async function storeMentions(
  tx: DatabaseTransaction,
  actor: Actor,
  text: { companyId: string; requestId: string; entryId: string | null; written: string },
): Promise<void> {
  const { companyId, requestId, entryId, written } = text;
  const keys = writtenMentionKeys(written);
  if (keys.length === 0) {
    return;
  }
  const byKey = new Map(
    (await mentionable(tx, actor, { companyId, requestId })).map((person) => [
      mentionKey(companyId, person.id),
      person,
    ]),
  );
  const mentioned = keys.flatMap((key) => byKey.get(key) ?? []).slice(0, MAX_MENTIONS_PER_TEXT);
  if (mentioned.length === 0) {
    return;
  }
  const rows = await tx
    .insert(requestMention)
    .values(mentioned.map(({ id, side }) => ({ requestId, entryId, userId: id, side })))
    .returning({ id: requestMention.id, userId: requestMention.userId });
  const rowOf = new Map(
    rows.flatMap((row) =>
      row.userId === null ? [] : [[mentionKey(companyId, row.userId), row.id] as const],
    ),
  );
  // Someone who is mentioned follows the request from then on.
  await subscribeAutomatically(
    tx,
    requestId,
    mentioned.map(({ id }) => id),
  );
  const stored = storeWrittenMentions(written, (key) => rowOf.get(key) ?? null);
  if (entryId === null) {
    await tx.update(request).set({ description: stored }).where(eq(request.id, requestId));
  } else {
    await tx.update(requestEntry).set({ body: stored }).where(eq(requestEntry.id, entryId));
  }
}
