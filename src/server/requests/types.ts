/**
 * @file Request types: the kinds of request the staff offer, which staff
 * Admins add, edit, reorder, archive and restore in Settings
 * (decision 0027). Requests hold a type's key; the request services look a
 * type up here when it's picked.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction, DatabaseTransaction } from '@/db';
import { requestType } from '@/db/schema';
import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';
import { type RequestPriority, requestTypeKeyFromName } from '@/lib/requests';
import {
  requestPrioritySchema,
  requestTypeDescriptionSchema,
  requestTypeNameSchema,
  requestTypeSchema,
} from '@/lib/validation';

import {
  assertNotSignedInAs,
  assertPermission,
  getGlobalPermissions,
  getStaffPermissionsInCompanies,
} from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { notFoundError, ServiceError } from '../errors';

/** A request type as the pages show it. */
export interface RequestTypeView {
  /** What requests hold, and the list's `?type=` filter. */
  key: string;
  /** Its name. */
  name: string;
  /** What it's for. */
  description: string;
  /**
   * The priority a new request of this type starts with; `null` for readers
   * without `requests:view-internal` (company users never see a priority).
   */
  startingPriority: RequestPriority | null;
  /** Whether it's archived: no longer offered for new requests or edits. */
  archived: boolean;
}

/** What the staff fill in for a type. */
interface RequestTypeInput {
  /** Its name. */
  name: string;
  /** What it's for. */
  description: string;
  /** The priority a new request of this type starts with (`REQUEST_PRIORITIES`). */
  startingPriority: string;
}

/** The types that were built in before the staff managed them, with the keys requests hold. */
const BUILT_IN_KEYS = ['hotfix', 'bug', 'support', 'new_feature'] as const;

/**
 * Lists every request type in its order, archived ones too, for everyone who
 * reads requests: the forms offer the active ones, and the lists and the
 * conversation name every type a request can have. The starting priorities
 * are only for the staff.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @returns The types, in order.
 */
export async function listRequestTypes(
  ctx: ServiceContext,
  actor: Actor,
): Promise<RequestTypeView[]> {
  const internal = getStaffPermissionsInCompanies(actor).has('requests:view-internal');
  const rows = await ctx.db
    .select({
      key: requestType.key,
      name: requestType.name,
      description: requestType.description,
      startingPriority: requestType.startingPriority,
      archivedAt: requestType.archivedAt,
    })
    .from(requestType)
    .orderBy(asc(requestType.position));
  return rows.map(({ archivedAt, startingPriority, ...type }) => ({
    ...type,
    startingPriority: internal ? startingPriority : null,
    archived: archivedAt !== null,
  }));
}

/**
 * The names of every request type by key, for the lists and the
 * conversation. Every key a request or its history holds has one: types are
 * never deleted.
 *
 * @param db - The database.
 * @returns Each type's name by its key.
 */
export async function requestTypeNames(db: DatabaseOrTransaction): Promise<Map<string, string>> {
  const rows = await db.select({ key: requestType.key, name: requestType.name }).from(requestType);
  return new Map(rows.map(({ key, name }) => [key, name]));
}

/**
 * The type a request is given (raised with, or changed to): it must exist and
 * not be archived. A request that already has an archived type keeps it;
 * this is only for a type that's picked.
 *
 * @param db - The database, or the change's transaction.
 * @param key - The type's key, as the form sent it.
 * @returns The type's key and starting priority.
 * @throws {ServiceError} `invalid` when there's no such type or it's archived
 *   (`errors.requestTypes.unavailable`).
 * @throws {ZodError} When the key isn't one in form.
 */
export async function typeToGive(
  db: DatabaseOrTransaction,
  key: string,
): Promise<{ key: string; startingPriority: RequestPriority }> {
  const parsed = requestTypeSchema.parse(key);
  const [found] = await db
    .select({ key: requestType.key, startingPriority: requestType.startingPriority })
    .from(requestType)
    .where(and(eq(requestType.key, parsed), isNull(requestType.archivedAt)));
  if (!found) {
    throw new ServiceError('invalid', 'errors.requestTypes.unavailable');
  }
  return found;
}

/**
 * Checks that the actor may manage request types: a staff Admin, not signed
 * in as someone else.
 *
 * @param actor - The acting user.
 * @throws {ServiceError} `signed_in_as`, or `forbidden` without `staff:manage`.
 */
function assertManagesTypes(actor: Actor): void {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
}

/**
 * Validates what the staff filled in for a type.
 *
 * @param input - The form's fields.
 * @returns The cleaned values.
 * @throws {ZodError} When a field isn't valid.
 */
function parseTypeInput(input: RequestTypeInput) {
  return {
    name: requestTypeNameSchema.parse(input.name),
    description: requestTypeDescriptionSchema.parse(input.description),
    startingPriority: requestPrioritySchema.parse(input.startingPriority),
  };
}

/**
 * Locks every type, in their order: adding and moving change the places of
 * types, and archiving checks how many stay active, so these changes take
 * turns. There are only ever a handful of types.
 *
 * @param tx - The change's transaction.
 * @returns Every type, in order, as it is now.
 */
async function lockTypes(tx: DatabaseTransaction) {
  return tx
    .select({
      id: requestType.id,
      key: requestType.key,
      name: requestType.name,
      description: requestType.description,
      startingPriority: requestType.startingPriority,
      position: requestType.position,
      archivedAt: requestType.archivedAt,
    })
    .from(requestType)
    .orderBy(asc(requestType.position))
    .for('update');
}

/**
 * Finds a type among the locked ones.
 *
 * @param types - The locked types.
 * @param key - The type's key, as the form sent it.
 * @returns The type.
 * @throws {ServiceError} `not_found` when there's no such type.
 */
function findType<T extends { key: string }>(types: readonly T[], key: string): T {
  const found = types.find((type) => type.key === key);
  if (!found) {
    throw notFoundError();
  }
  return found;
}

/**
 * Adds a request type at the end of the list. Its key comes from its name
 * (`requestTypeKeyFromName`), unlike any key a type has ever had.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param input - The type's name, what it's for and its starting priority.
 * @returns The new type's key.
 * @throws {ServiceError} `signed_in_as`, `forbidden`.
 * @throws {ZodError} When a field isn't valid.
 */
export async function addRequestType(
  ctx: ServiceContext,
  actor: Actor,
  input: RequestTypeInput,
): Promise<{ key: string }> {
  assertManagesTypes(actor);
  const values = parseTypeInput(input);
  return ctx.db.transaction(async (tx) => {
    const types = await lockTypes(tx);
    const keys = new Set(types.map(({ key }) => key));
    const key = requestTypeKeyFromName(values.name, (candidate) => keys.has(candidate));
    const position = Math.max(0, ...types.map((type) => type.position)) + 1;
    await tx.insert(requestType).values({ ...values, key, position });
    await recordEvent(
      ctx,
      {
        action: 'request_type_added',
        actorUserId: actor.id,
        details: { type: key, name: values.name, startingPriority: values.startingPriority },
      },
      tx,
    );
    return { key };
  });
}

/**
 * Changes a type's name, what it's for and its starting priority. Its key
 * stays, so its requests, their history and links to the list keep it; a
 * new starting priority is for requests raised from now on.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param input - The type's key, and its new fields.
 * @param input.type - The type's key.
 * @returns Whether anything changed.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `not_found` when there's no such type.
 * @throws {ZodError} When a field isn't valid.
 */
export async function updateRequestType(
  ctx: ServiceContext,
  actor: Actor,
  input: RequestTypeInput & { type: string },
): Promise<{ changed: boolean }> {
  assertManagesTypes(actor);
  const values = parseTypeInput(input);
  return ctx.db.transaction(async (tx) => {
    const found = findType(await lockTypes(tx), input.type);
    const from = {
      name: found.name,
      description: found.description,
      startingPriority: found.startingPriority,
    };
    if (
      from.name === values.name &&
      from.description === values.description &&
      from.startingPriority === values.startingPriority
    ) {
      return { changed: false };
    }
    await tx
      .update(requestType)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(requestType.id, found.id));
    await recordEvent(
      ctx,
      {
        action: 'request_type_changed',
        actorUserId: actor.id,
        details: { type: found.key, from, to: values },
      },
      tx,
    );
    return { changed: true };
  });
}

/**
 * Moves a type one place up or down in the list, by swapping places with
 * its neighbour (archived types keep their places too). A type that's first
 * or last already stays where it is. Not an audit event: it changes no
 * request.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param input - The type's key and the direction.
 * @param input.type - The type's key.
 * @param input.direction - `up` or `down`.
 * @returns Whether it moved.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `not_found` when there's no such type.
 */
export async function moveRequestType(
  ctx: ServiceContext,
  actor: Actor,
  input: { type: string; direction: string },
): Promise<{ moved: boolean }> {
  assertManagesTypes(actor);
  if (input.direction !== 'up' && input.direction !== 'down') {
    throw notFoundError();
  }
  return ctx.db.transaction(async (tx) => {
    const types = await lockTypes(tx);
    const found = findType(types, input.type);
    const index = types.indexOf(found);
    const neighbour = types[input.direction === 'up' ? index - 1 : index + 1];
    if (!neighbour) {
      return { moved: false };
    }
    // Through a free place (0), since no two types may share one even for a moment.
    await tx.update(requestType).set({ position: 0 }).where(eq(requestType.id, found.id));
    await tx
      .update(requestType)
      .set({ position: found.position })
      .where(eq(requestType.id, neighbour.id));
    await tx
      .update(requestType)
      .set({ position: neighbour.position })
      .where(eq(requestType.id, found.id));
    return { moved: true };
  });
}

/**
 * Archives a type: it's no longer offered for new requests or edits. The
 * requests that have it keep it, and the list's filter and the history still
 * name it. The last type that isn't archived can't be: a request always needs
 * a type to be raised with.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param input - The type's key.
 * @param input.type - The type's key.
 * @returns Whether it changed (it may have been archived already), and the type's name, for the
 *   confirmation.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `not_found` when there's no such type,
 *   `invalid` for the last active type (`errors.requestTypes.lastActive`).
 */
export async function archiveRequestType(
  ctx: ServiceContext,
  actor: Actor,
  input: { type: string },
): Promise<{ changed: boolean; name: string }> {
  assertManagesTypes(actor);
  return ctx.db.transaction(async (tx) => {
    const types = await lockTypes(tx);
    const found = findType(types, input.type);
    if (found.archivedAt !== null) {
      return { changed: false, name: found.name };
    }
    const othersActive = types.filter(
      ({ id, archivedAt }) => id !== found.id && archivedAt === null,
    ).length;
    if (othersActive === 0) {
      throw new ServiceError('invalid', 'errors.requestTypes.lastActive');
    }
    await tx
      .update(requestType)
      .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(requestType.id, found.id));
    await recordEvent(
      ctx,
      {
        action: 'request_type_archived',
        actorUserId: actor.id,
        details: { type: found.key, name: found.name },
      },
      tx,
    );
    return { changed: true, name: found.name };
  });
}

/**
 * Restores an archived type, so it's offered again.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param input - The type's key.
 * @param input.type - The type's key.
 * @returns Whether it changed (it may not have been archived), and the type's name, for the
 *   confirmation.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `not_found` when there's no such type.
 */
export async function restoreRequestType(
  ctx: ServiceContext,
  actor: Actor,
  input: { type: string },
): Promise<{ changed: boolean; name: string }> {
  assertManagesTypes(actor);
  return ctx.db.transaction(async (tx) => {
    const found = findType(await lockTypes(tx), input.type);
    if (found.archivedAt === null) {
      return { changed: false, name: found.name };
    }
    await tx
      .update(requestType)
      .set({ archivedAt: null, updatedAt: sql`now()` })
      .where(eq(requestType.id, found.id));
    await recordEvent(
      ctx,
      {
        action: 'request_type_restored',
        actorUserId: actor.id,
        details: { type: found.key, name: found.name },
      },
      tx,
    );
    return { changed: true, name: found.name };
  });
}

/**
 * Names the built-in types in a language: setup calls it with the language
 * it's set up in, since the migration that added them named them in English
 * before there was one. Only a built-in type nobody changed yet is renamed.
 *
 * @param tx - Setup's transaction.
 * @param locale - The language to name them in.
 */
export async function nameBuiltInRequestTypes(
  tx: DatabaseTransaction,
  locale: Locale,
): Promise<void> {
  // i18n-check t('requests.builtInTypes.hotfix.name')
  // i18n-check t('requests.builtInTypes.hotfix.description')
  // i18n-check t('requests.builtInTypes.bug.name')
  // i18n-check t('requests.builtInTypes.bug.description')
  // i18n-check t('requests.builtInTypes.support.name')
  // i18n-check t('requests.builtInTypes.support.description')
  // i18n-check t('requests.builtInTypes.new_feature.name')
  // i18n-check t('requests.builtInTypes.new_feature.description')
  const t = translator(locale, 'requests.builtInTypes');
  const texts: Record<(typeof BUILT_IN_KEYS)[number], { name: string; description: string }> = {
    hotfix: { name: t('hotfix.name'), description: t('hotfix.description') },
    bug: { name: t('bug.name'), description: t('bug.description') },
    support: { name: t('support.name'), description: t('support.description') },
    new_feature: { name: t('new_feature.name'), description: t('new_feature.description') },
  };
  /**
   * One of the texts per key, as a value for the update.
   *
   * @param field - Which text.
   * @returns The value.
   */
  const byKey = (field: 'name' | 'description') =>
    sql`case ${requestType.key} ${sql.join(
      BUILT_IN_KEYS.map((key) => sql`when ${key} then ${texts[key][field]}`),
      sql` `,
    )} end`;
  await tx
    .update(requestType)
    .set({ name: byKey('name'), description: byKey('description') })
    .where(and(inArray(requestType.key, [...BUILT_IN_KEYS]), isNull(requestType.updatedAt)));
}
