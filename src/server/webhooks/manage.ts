/**
 * @file Managing webhooks: the staff who manage request types (staff Admins,
 * `staff:manage`) list, add, change, turn off and on and remove them, and
 * renew their signing secrets, on Settings › Integrations. A webhook sends
 * request texts out of Adiutor, so every change that can point them
 * somewhere new (adding, changing, renewing, turning on) needs the Admin's
 * second step from the last 15 minutes; turning off and removing don't.
 * Each change is rate-limited and recorded in the audit log, with the
 * webhook's name and host, never its address or secret. The address and the
 * secret are stored sealed (`sealed-secrets.ts`), and the secret is shown
 * once, when it's made.
 *
 * The rows are locked `FOR NO KEY UPDATE`: a request change that queues a
 * delivery only takes `FOR KEY SHARE` on the webhook (its foreign key), so
 * it never waits for an edit here (lock order: request, webhook, delivery).
 */
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { DatabaseOrTransaction, DatabaseTransaction } from '@/db';
import { requestType, webhook, webhookDelivery, webhookRequestType } from '@/db/schema';
import { needsRecentConfirmation } from '@/lib/authz/mfa';
import { firstRow } from '@/lib/defined';
import { env } from '@/lib/env';
import {
  webhookEventsSchema,
  webhookFormatSchema,
  webhookNameSchema,
  webhookTypesSchema,
  webhookUrlSchema,
} from '@/lib/validation';
import type { WebhookEvent, WebhookFormat, WebhookOffReason } from '@/lib/webhooks';

import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { notFoundError, parseId, ServiceError } from '../errors';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { openSecret, sealSecret } from '../sealed-secrets';
import assertManagesWebhooks from './access';
import { pointsInside, serverAddressRules } from './address-guard';
import { newWebhookSecret } from './signing';

/** A webhook as Settings shows it: never its address (only the host) or its secret. */
export interface WebhookView {
  /** Its ID. */
  id: string;
  /** What the staff call it. */
  name: string;
  /** Its address's host (and port). */
  host: string;
  /** How it's sent. */
  format: WebhookFormat;
  /** What it's told about, in the order of `WEBHOOK_EVENTS`. */
  events: WebhookEvent[];
  /** Whether it covers every request type, new ones too. */
  allTypes: boolean;
  /** The keys of the types it covers when it doesn't cover them all, in the types' order. */
  types: string[];
  /** Whether it's on. */
  on: boolean;
  /** Why it's off, while it is. */
  offReason: WebhookOffReason | null;
  /** When it was turned off, while it is. */
  turnedOffAt: Date | null;
  /** Since when its deliveries have done nothing but fail. */
  failingSince: Date | null;
  /** When its secret was last renewed. */
  secretRenewedAt: Date | null;
  /** When it was added. */
  createdAt: Date;
}

/** What a staff Admin fills in for a webhook, as the form sends it. */
export interface WebhookInput {
  /** Its name. */
  name: string;
  /** Its address; left empty when changing a webhook, it keeps the saved one. */
  url: string;
  /** How it's sent (`WEBHOOK_FORMATS`). */
  format: string;
  /** What it's told about (`WEBHOOK_EVENTS`). */
  events: readonly string[];
  /** Whether it covers every request type. */
  allTypes: boolean;
  /** The keys of the types it covers otherwise. */
  types: readonly string[];
}

/**
 * Checks that the actor confirmed it's them with their second step in the
 * last 15 minutes, for a change that can send request texts somewhere new.
 *
 * @param actor - The acting user.
 * @throws {ServiceError} `confirmation_required` otherwise.
 */
function assertConfirmed(actor: Actor): void {
  if (needsRecentConfirmation(actor)) {
    throw new ServiceError('confirmation_required', 'errors.webhooks.confirmationRequired');
  }
}

/**
 * Counts a change against the actor's limit.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @throws {ServiceError} `rate_limited` past `webhookChangesPerUser`.
 */
async function assertChangeLimit(ctx: ServiceContext, actor: Actor): Promise<void> {
  await assertRateLimit(ctx, `webhook-change:user:${actor.id}`, RATE_LIMITS.webhookChangesPerUser);
}

/**
 * Checks an address: by the rules the browser shares, then that it doesn't
 * point inside Adiutor's own network now (every connection checks again).
 *
 * @param value - The address as typed.
 * @returns The address, trimmed and parsed.
 * @throws {ServiceError} `invalid` when it points inside the network.
 * @throws {ZodError} When it breaks the shared rules.
 */
async function checkedUrl(value: string): Promise<{ url: string; host: string }> {
  const url = webhookUrlSchema(env.NODE_ENV === 'production').parse(value);
  const parsed = new URL(url);
  if (await pointsInside(parsed, serverAddressRules())) {
    throw new ServiceError('invalid', 'validation.webhookUrl.internal');
  }
  return { url, host: parsed.host };
}

/**
 * Checks the fields every webhook has, but its address.
 *
 * @param tx - The change's transaction, to look the types up.
 * @param input - The form's fields.
 * @returns The cleaned values.
 * @throws {ServiceError} `invalid` for types that don't exist, or none chosen.
 * @throws {ZodError} When a field isn't valid.
 */
async function checkedFields(tx: DatabaseTransaction, input: WebhookInput) {
  const name = webhookNameSchema.parse(input.name);
  const format = webhookFormatSchema.parse(input.format);
  const events = webhookEventsSchema.parse(input.events);
  const types = input.allTypes ? [] : webhookTypesSchema.parse(input.types);
  if (!input.allTypes) {
    if (types.length === 0) {
      throw new ServiceError('invalid', 'validation.webhookTypes.empty');
    }
    const known = await tx
      .select({ key: requestType.key })
      .from(requestType)
      .where(inArray(requestType.key, types));
    if (known.length !== types.length) {
      throw new ServiceError('invalid', 'validation.webhookTypes.unknown');
    }
  }
  return { name, format, events, allTypes: input.allTypes, types };
}

/**
 * The keys of the types each webhook covers, in the types' order.
 *
 * @param db - The database or a transaction.
 * @param webhookIds - The webhooks.
 * @returns Each webhook's type keys.
 */
async function typesOf(
  db: DatabaseOrTransaction,
  webhookIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byWebhook = new Map<string, string[]>();
  if (webhookIds.length === 0) {
    return byWebhook;
  }
  const rows = await db
    .select({ webhookId: webhookRequestType.webhookId, key: webhookRequestType.requestTypeKey })
    .from(webhookRequestType)
    .innerJoin(requestType, eq(requestType.key, webhookRequestType.requestTypeKey))
    .where(inArray(webhookRequestType.webhookId, [...webhookIds]))
    .orderBy(asc(requestType.position));
  rows.forEach(({ webhookId, key }) => {
    byWebhook.set(webhookId, [...(byWebhook.get(webhookId) ?? []), key]);
  });
  return byWebhook;
}

/** The columns a {@link WebhookView} is made of. */
const viewColumns = {
  id: webhook.id,
  name: webhook.name,
  host: webhook.urlHost,
  format: webhook.format,
  events: webhook.events,
  allTypes: webhook.allTypes,
  turnedOffAt: webhook.turnedOffAt,
  offReason: webhook.turnedOffReason,
  failingSince: webhook.failingSince,
  secretRenewedAt: webhook.secretRenewedAt,
  createdAt: webhook.createdAt,
};

/**
 * Lists every webhook, by name.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @returns The webhooks.
 * @throws {ServiceError} `signed_in_as`, `forbidden`.
 */
export async function listWebhooks(ctx: ServiceContext, actor: Actor): Promise<WebhookView[]> {
  assertManagesWebhooks(actor);
  const rows = await ctx.db
    .select(viewColumns)
    .from(webhook)
    .orderBy(asc(webhook.name), asc(webhook.id));
  const types = await typesOf(
    ctx.db,
    rows.map(({ id }) => id),
  );
  return rows.map((row) => ({
    ...row,
    on: row.turnedOffAt === null,
    types: types.get(row.id) ?? [],
  }));
}

/**
 * One webhook.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param ref - Which webhook.
 * @param ref.webhook - Its ID.
 * @returns The webhook.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `not_found`.
 */
export async function getWebhook(
  ctx: ServiceContext,
  actor: Actor,
  ref: { webhook: string },
): Promise<WebhookView> {
  assertManagesWebhooks(actor);
  const id = parseId(ref.webhook);
  const [row] = await ctx.db.select(viewColumns).from(webhook).where(eq(webhook.id, id));
  if (!row) {
    throw notFoundError();
  }
  const types = await typesOf(ctx.db, [id]);
  return { ...row, on: row.turnedOffAt === null, types: types.get(id) ?? [] };
}

/**
 * Locks a webhook for a change.
 *
 * @param tx - The change's transaction.
 * @param id - The webhook's ID.
 * @returns The webhook as it is now.
 * @throws {ServiceError} `not_found` when there's no such webhook.
 */
async function lockWebhook(tx: DatabaseTransaction, id: string) {
  const [row] = await tx
    .select({
      id: webhook.id,
      name: webhook.name,
      urlSealed: webhook.urlSealed,
      urlHost: webhook.urlHost,
      format: webhook.format,
      events: webhook.events,
      allTypes: webhook.allTypes,
      secretSealed: webhook.secretSealed,
      turnedOffAt: webhook.turnedOffAt,
    })
    .from(webhook)
    .where(eq(webhook.id, id))
    .for('no key update');
  if (!row) {
    throw notFoundError();
  }
  return row;
}

/**
 * Replaces the types a webhook covers.
 *
 * @param tx - The change's transaction.
 * @param webhookId - The webhook.
 * @param types - The type keys; none for a webhook that covers them all.
 */
async function storeTypes(
  tx: DatabaseTransaction,
  webhookId: string,
  types: readonly string[],
): Promise<void> {
  await tx.delete(webhookRequestType).where(eq(webhookRequestType.webhookId, webhookId));
  if (types.length > 0) {
    await tx
      .insert(webhookRequestType)
      .values(types.map((requestTypeKey) => ({ webhookId, requestTypeKey })));
  }
}

/**
 * Adds a webhook, on, with a new signing secret. Needs a recent second step:
 * from now on, request texts go to its address.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage` and a recent confirmation.
 * @param input - The form's fields.
 * @returns The new webhook's ID and its secret, to show once.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `confirmation_required`,
 *   `rate_limited`, or `invalid` for an address inside Adiutor's network or
 *   types that don't exist.
 * @throws {ZodError} When a field isn't valid.
 */
export async function addWebhook(
  ctx: ServiceContext,
  actor: Actor,
  input: WebhookInput,
): Promise<{ id: string; secret: string }> {
  assertManagesWebhooks(actor);
  assertConfirmed(actor);
  await assertChangeLimit(ctx, actor);
  const { url, host } = await checkedUrl(input.url);
  const secret = newWebhookSecret();
  const [urlSealed, secretSealed] = await Promise.all([sealSecret(url), sealSecret(secret)]);
  return ctx.db.transaction(async (tx) => {
    const fields = await checkedFields(tx, input);
    const added = firstRow(
      await tx
        .insert(webhook)
        .values({
          name: fields.name,
          urlSealed,
          urlHost: host,
          format: fields.format,
          events: fields.events,
          allTypes: fields.allTypes,
          secretSealed,
          createdBy: actor.id,
        })
        .returning({ id: webhook.id }),
      'the added webhook',
    );
    await storeTypes(tx, added.id, fields.types);
    await recordEvent(
      ctx,
      {
        action: 'webhook_added',
        actorUserId: actor.id,
        details: { staff: true, webhook: fields.name, host },
      },
      tx,
    );
    return { id: added.id, secret };
  });
}

/**
 * Whether two lists hold the same values in the same order.
 *
 * @param a - One list.
 * @param b - The other.
 * @returns Whether they're the same.
 */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Changes a webhook's name, address, format, events or types. An empty
 * address keeps the saved one. Needs a recent second step, as any of these
 * can send more, or send it somewhere else.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage` and a recent confirmation.
 * @param input - The webhook's ID, and its fields.
 * @param input.webhook - The webhook's ID.
 * @returns Whether anything changed.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `confirmation_required`,
 *   `rate_limited`, `not_found`, or `invalid`.
 * @throws {ZodError} When a field isn't valid.
 */
export async function updateWebhook(
  ctx: ServiceContext,
  actor: Actor,
  input: WebhookInput & { webhook: string },
): Promise<{ changed: boolean }> {
  assertManagesWebhooks(actor);
  const id = parseId(input.webhook);
  assertConfirmed(actor);
  await assertChangeLimit(ctx, actor);
  const typed = input.url.trim() === '' ? null : await checkedUrl(input.url);
  const typedSealed = typed ? await sealSecret(typed.url) : null;
  return ctx.db.transaction(async (tx) => {
    const found = await lockWebhook(tx, id);
    const fields = await checkedFields(tx, input);
    const savedUrl = typed ? await openSecret(found.urlSealed).catch(() => null) : null;
    const urlChanged = typed !== null && typed.url !== savedUrl;
    const savedTypes = found.allTypes ? [] : ((await typesOf(tx, [id])).get(id) ?? []);
    const changes = [
      fields.name !== found.name && 'name',
      urlChanged && 'url',
      fields.format !== found.format && 'format',
      !sameList(fields.events, found.events) && 'events',
      (fields.allTypes !== found.allTypes ||
        !sameList([...fields.types].sort(), [...savedTypes].sort())) &&
        'types',
    ].filter((change): change is string => change !== false);
    if (changes.length === 0) {
      return { changed: false };
    }
    const host = urlChanged && typed ? typed.host : found.urlHost;
    await tx
      .update(webhook)
      .set({
        name: fields.name,
        format: fields.format,
        events: fields.events,
        allTypes: fields.allTypes,
        ...(urlChanged && typedSealed && { urlSealed: typedSealed, urlHost: host }),
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, id));
    await storeTypes(tx, id, fields.types);
    await recordEvent(
      ctx,
      {
        action: 'webhook_changed',
        actorUserId: actor.id,
        details: {
          staff: true,
          webhook: fields.name,
          host,
          changes,
          ...(urlChanged && host !== found.urlHost && { previousHost: found.urlHost }),
        },
      },
      tx,
    );
    return { changed: true };
  });
}

/**
 * Gives a webhook a new signing secret, which replaces the old one straight
 * away: deliveries that fail meanwhile are tried again, by when the receiver
 * has the new one. Needs a recent second step.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage` and a recent confirmation.
 * @param ref - Which webhook.
 * @param ref.webhook - Its ID.
 * @returns The new secret, to show once.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `confirmation_required`,
 *   `rate_limited`, `not_found`.
 */
export async function renewWebhookSecret(
  ctx: ServiceContext,
  actor: Actor,
  ref: { webhook: string },
): Promise<{ secret: string }> {
  assertManagesWebhooks(actor);
  const id = parseId(ref.webhook);
  assertConfirmed(actor);
  await assertChangeLimit(ctx, actor);
  const secret = newWebhookSecret();
  const secretSealed = await sealSecret(secret);
  await ctx.db.transaction(async (tx) => {
    const found = await lockWebhook(tx, id);
    await tx
      .update(webhook)
      .set({ secretSealed, secretRenewedAt: new Date() })
      .where(eq(webhook.id, id));
    await recordEvent(
      ctx,
      {
        action: 'webhook_secret_renewed',
        actorUserId: actor.id,
        details: { staff: true, webhook: found.name, host: found.urlHost },
      },
      tx,
    );
  });
  return { secret };
}

/**
 * Turns a webhook off or on. Off, it's told nothing, and what was still to
 * be delivered to it is cancelled; it needs no confirmation, since it sends
 * less. On again needs a recent second step, and an address and secret that
 * can still be read; it starts with a clean slate (no days of failures), and
 * what happened while it was off isn't sent.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage` (and a recent confirmation to turn it on).
 * @param input - Which webhook, and whether it's on.
 * @param input.webhook - Its ID.
 * @param input.on - Whether to turn it on.
 * @returns Whether anything changed.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `confirmation_required`,
 *   `rate_limited`, `not_found`, or `invalid` when its address or secret can't be read.
 */
export async function setWebhookOn(
  ctx: ServiceContext,
  actor: Actor,
  input: { webhook: string; on: boolean },
): Promise<{ changed: boolean }> {
  assertManagesWebhooks(actor);
  const id = parseId(input.webhook);
  if (input.on) {
    assertConfirmed(actor);
  }
  await assertChangeLimit(ctx, actor);
  return ctx.db.transaction(async (tx) => {
    const found = await lockWebhook(tx, id);
    if ((found.turnedOffAt === null) === input.on) {
      return { changed: false };
    }
    if (input.on) {
      const readable = await Promise.all([
        openSecret(found.urlSealed),
        openSecret(found.secretSealed),
      ]).then(
        () => true,
        () => false,
      );
      if (!readable) {
        throw new ServiceError('invalid', 'errors.webhooks.unreadable');
      }
      await tx
        .update(webhook)
        .set({ turnedOffAt: null, turnedOffReason: null, turnedOffBy: null, failingSince: null })
        .where(eq(webhook.id, id));
    } else {
      await tx
        .update(webhook)
        .set({ turnedOffAt: new Date(), turnedOffReason: 'manual', turnedOffBy: actor.id })
        .where(eq(webhook.id, id));
      await tx
        .update(webhookDelivery)
        .set({ status: 'cancelled', nextAttemptAt: null })
        .where(and(eq(webhookDelivery.webhookId, id), eq(webhookDelivery.status, 'pending')));
    }
    await recordEvent(
      ctx,
      {
        action: input.on ? 'webhook_turned_on' : 'webhook_turned_off',
        actorUserId: actor.id,
        details: {
          staff: true,
          webhook: found.name,
          host: found.urlHost,
          ...(!input.on && { reason: 'manual' }),
        },
      },
      tx,
    );
    return { changed: true };
  });
}

/**
 * Removes a webhook, with its deliveries. Nothing more is sent to it; it
 * needs no confirmation, since it sends less.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param ref - Which webhook.
 * @param ref.webhook - Its ID.
 * @returns The removed webhook's name.
 * @throws {ServiceError} `signed_in_as`, `forbidden`, `rate_limited`, `not_found`.
 */
export async function removeWebhook(
  ctx: ServiceContext,
  actor: Actor,
  ref: { webhook: string },
): Promise<{ name: string }> {
  assertManagesWebhooks(actor);
  const id = parseId(ref.webhook);
  await assertChangeLimit(ctx, actor);
  return ctx.db.transaction(async (tx) => {
    const found = await lockWebhook(tx, id);
    await tx.delete(webhook).where(eq(webhook.id, id));
    await recordEvent(
      ctx,
      {
        action: 'webhook_removed',
        actorUserId: actor.id,
        details: { staff: true, webhook: found.name, host: found.urlHost },
      },
      tx,
    );
    return { name: found.name };
  });
}
