/**
 * @file Integration tests for managing webhooks: adding one with a secret
 * shown once and its address and secret sealed, what Settings is shown
 * (the host, never the address), changing, renewing, turning off and on,
 * removing, the refusals (addresses inside Adiutor's network, fields that
 * aren't valid), the second step from the last 15 minutes that every change
 * which can send more needs, and the audit log, which names the webhook and
 * its host only. Which roles may manage webhooks is in the authorization
 * matrix.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { webhook, webhookDelivery } from '@/db/schema';

import {
  actorFor,
  auditEvents,
  createCompany,
  enableTwoFactor,
  fillRateLimitBucket,
  readWebhook,
  setupTestContext,
  staffActor,
  storeRequest,
  storeWebhook,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { RATE_LIMITS } from '../rate-limit';
import {
  addWebhook,
  getWebhook,
  listWebhooks,
  removeWebhook,
  renewWebhookSecret,
  setWebhookOn,
  updateWebhook,
} from './manage';

const { ctx, db } = setupTestContext();

/** A webhook as the form sends it, to an address that never resolves (`.test`). */
const FORM = {
  name: 'Procurement',
  url: 'https://hooks.adiutor.test/in?token=s3cret-token',
  format: 'json',
  events: ['raised', 'reply'],
  allTypes: true,
  types: [],
} as const;

let admin: Actor;

beforeEach(async () => {
  admin = await staffActor(db, 'platform_admin');
});

/**
 * The webhooks' audit events, oldest first.
 *
 * @returns Each event's action and details.
 */
async function webhookEvents() {
  return auditEvents(db, { actionLike: 'webhook_%', fields: ['action', 'details'] });
}

/**
 * A staff Admin with an authenticator app whose last confirmation was 30
 * minutes ago: too long for a change that can send more.
 *
 * @returns The actor.
 */
async function unconfirmedAdmin(): Promise<Actor> {
  const { id } = await staffActor(db, 'platform_admin');
  await enableTwoFactor(db, id);
  const at = new Date(Date.now() - 30 * 60_000);
  return actorFor(db, id, { confirmedAt: at, signedInAt: at });
}

describe('addWebhook', () => {
  it('adds a webhook that’s on, gives its secret once and keeps address and secret sealed', async () => {
    const { id, secret } = await addWebhook(ctx, admin, { ...FORM, events: ['reply', 'raised'] });

    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    const [row] = await db.select().from(webhook).where(eq(webhook.id, id));
    expect(row?.urlSealed).not.toContain('hooks.adiutor.test');
    expect(row?.urlSealed).not.toContain('s3cret-token');
    expect(row?.secretSealed).not.toContain(secret.slice(6));
    expect(await readWebhook(db, id)).toMatchObject({
      url: FORM.url,
      secret,
      urlHost: 'hooks.adiutor.test',
      createdBy: admin.id,
    });
    expect(await getWebhook(ctx, admin, { webhook: id })).toMatchObject({
      name: 'Procurement',
      host: 'hooks.adiutor.test',
      format: 'json',
      events: ['raised', 'reply'],
      allTypes: true,
      types: [],
      on: true,
      offReason: null,
    });
    expect(await webhookEvents()).toEqual([
      {
        action: 'webhook_added',
        details: { staff: true, webhook: 'Procurement', host: 'hooks.adiutor.test' },
      },
    ]);
  });

  it('covers the chosen types only, in the types’ order', async () => {
    const { id } = await addWebhook(ctx, admin, {
      ...FORM,
      allTypes: false,
      types: ['support', 'hotfix', 'support'],
    });

    expect(await getWebhook(ctx, admin, { webhook: id })).toMatchObject({
      allTypes: false,
      types: ['hotfix', 'support'],
    });
  });

  it('refuses addresses inside Adiutor’s network, whichever way they’re written', async () => {
    for (const url of [
      'http://10.0.0.5/hook',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]:4000/hook',
      'http://2130706433/hook',
      'http://[::ffff:192.168.1.1]/hook',
    ]) {
      // eslint-disable-next-line no-await-in-loop -- one address at a time, each refused before anything is stored
      await expect(addWebhook(ctx, admin, { ...FORM, url }), url).rejects.toMatchObject({
        code: 'invalid',
        key: 'validation.webhookUrl.internal',
      });
    }
    expect(await db.select().from(webhook)).toEqual([]);
  });

  it('refuses fields that aren’t valid', async () => {
    await expect(
      addWebhook(ctx, admin, { ...FORM, url: 'https://user:pass@hooks.adiutor.test/in' }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      addWebhook(ctx, admin, { ...FORM, url: 'ftp://hooks.adiutor.test' }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(addWebhook(ctx, admin, { ...FORM, events: [] })).rejects.toBeInstanceOf(ZodError);
    await expect(
      addWebhook(ctx, admin, { ...FORM, events: ['everything'] }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(addWebhook(ctx, admin, { ...FORM, format: 'xml' })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      addWebhook(ctx, admin, { ...FORM, name: 'See hooks.adiutor.dev' }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      addWebhook(ctx, admin, { ...FORM, allTypes: false, types: [] }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'validation.webhookTypes.empty' });
    await expect(
      addWebhook(ctx, admin, { ...FORM, allTypes: false, types: ['printers'] }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'validation.webhookTypes.unknown' });
    expect(await db.select().from(webhook)).toEqual([]);
  });

  it('counts against the actor’s limit', async () => {
    await fillRateLimitBucket(
      db,
      `webhook-change:user:${admin.id}`,
      RATE_LIMITS.webhookChangesPerUser.limit,
    );
    await expect(addWebhook(ctx, admin, FORM)).rejects.toMatchObject({ code: 'rate_limited' });
  });
});

describe('a recent second step', () => {
  it('is needed to add, change, renew or turn on, and changes nothing without it', async () => {
    const unconfirmed = await unconfirmedAdmin();
    const id = await storeWebhook(db, { off: { at: new Date(), reason: 'manual' } });
    const refused = { code: 'confirmation_required', key: 'errors.webhooks.confirmationRequired' };

    await expect(addWebhook(ctx, unconfirmed, FORM)).rejects.toMatchObject(refused);
    await expect(
      updateWebhook(ctx, unconfirmed, { ...FORM, url: '', webhook: id }),
    ).rejects.toMatchObject(refused);
    await expect(renewWebhookSecret(ctx, unconfirmed, { webhook: id })).rejects.toMatchObject(
      refused,
    );
    await expect(setWebhookOn(ctx, unconfirmed, { webhook: id, on: true })).rejects.toMatchObject(
      refused,
    );
    expect(await webhookEvents()).toEqual([]);
  });

  it('isn’t needed to turn off or remove, which send less', async () => {
    const unconfirmed = await unconfirmedAdmin();
    const id = await storeWebhook(db);

    expect(await setWebhookOn(ctx, unconfirmed, { webhook: id, on: false })).toEqual({
      changed: true,
    });
    expect(await removeWebhook(ctx, unconfirmed, { webhook: id })).toEqual({
      name: 'Adiutor Tests hook',
    });
  });
});

describe('listWebhooks', () => {
  it('lists every webhook by name, with its host and never its address', async () => {
    await storeWebhook(db, { name: 'Staff chat', format: 'chat', types: ['bug'] });
    await storeWebhook(db, { name: 'Procurement', url: 'https://hooks.adiutor.test:8443/in?k=1' });

    const webhooks = await listWebhooks(ctx, admin);
    expect(webhooks.map(({ name, host, types }) => ({ name, host, types }))).toEqual([
      { name: 'Procurement', host: 'hooks.adiutor.test:8443', types: [] },
      { name: 'Staff chat', host: 'hooks.adiutor.test', types: ['bug'] },
    ]);
    expect(JSON.stringify(webhooks)).not.toContain('k=1');
  });
});

describe('updateWebhook', () => {
  it('keeps the saved address when the field is left empty, and records what changed', async () => {
    const id = await storeWebhook(db, { name: 'Procurement', events: ['raised'] });

    expect(
      await updateWebhook(ctx, admin, {
        ...FORM,
        name: 'Purchasing',
        url: '',
        events: ['raised', 'status'],
        allTypes: false,
        types: ['bug'],
        webhook: id,
      }),
    ).toEqual({ changed: true });

    expect(await readWebhook(db, id)).toMatchObject({
      name: 'Purchasing',
      url: 'https://hooks.adiutor.test/in',
      events: ['raised', 'status'],
      allTypes: false,
    });
    expect(await getWebhook(ctx, admin, { webhook: id })).toMatchObject({ types: ['bug'] });
    expect(await webhookEvents()).toEqual([
      {
        action: 'webhook_changed',
        details: {
          staff: true,
          webhook: 'Purchasing',
          host: 'hooks.adiutor.test',
          changes: ['name', 'events', 'types'],
        },
      },
    ]);
  });

  it('takes a new address with its host, naming the one it replaced', async () => {
    const id = await storeWebhook(db, { name: 'Procurement', events: ['raised', 'reply'] });

    await updateWebhook(ctx, admin, {
      ...FORM,
      url: 'https://intake.adiutor.test/hooks',
      webhook: id,
    });

    expect(await readWebhook(db, id)).toMatchObject({
      url: 'https://intake.adiutor.test/hooks',
      urlHost: 'intake.adiutor.test',
    });
    expect(await webhookEvents()).toEqual([
      {
        action: 'webhook_changed',
        details: {
          staff: true,
          webhook: 'Procurement',
          host: 'intake.adiutor.test',
          changes: ['url'],
          previousHost: 'hooks.adiutor.test',
        },
      },
    ]);
  });

  it('changes nothing and records nothing when the same values come back', async () => {
    const id = await storeWebhook(db, {
      name: 'Procurement',
      events: ['raised', 'reply'],
      types: ['bug', 'hotfix'],
    });

    expect(
      await updateWebhook(ctx, admin, {
        ...FORM,
        url: 'https://hooks.adiutor.test/in',
        allTypes: false,
        types: ['hotfix', 'bug'],
        webhook: id,
      }),
    ).toEqual({ changed: false });
    expect(await webhookEvents()).toEqual([]);
  });

  it('refuses a new address inside Adiutor’s network, and a webhook that isn’t there', async () => {
    const id = await storeWebhook(db);

    await expect(
      updateWebhook(ctx, admin, { ...FORM, url: 'http://192.168.0.10/hook', webhook: id }),
    ).rejects.toMatchObject({ key: 'validation.webhookUrl.internal' });
    await expect(
      updateWebhook(ctx, admin, { ...FORM, url: '', webhook: 'not-an-id' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      updateWebhook(ctx, admin, {
        ...FORM,
        url: '',
        webhook: '019abcde-0000-7000-8000-000000000000',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('renewWebhookSecret', () => {
  it('gives a new secret, sealed, and records it', async () => {
    const id = await storeWebhook(db);
    const before = await readWebhook(db, id);

    const { secret } = await renewWebhookSecret(ctx, admin, { webhook: id });

    expect(secret).not.toBe(before?.secret);
    expect(await readWebhook(db, id)).toMatchObject({ secret, secretRenewedAt: expect.any(Date) });
    expect(await webhookEvents()).toEqual([
      {
        action: 'webhook_secret_renewed',
        details: { staff: true, webhook: 'Adiutor Tests hook', host: 'hooks.adiutor.test' },
      },
    ]);
  });
});

describe('setWebhookOn', () => {
  it('turns a webhook off, cancelling what was still to be delivered', async () => {
    const company = await createCompany(db);
    const { id: requestId } = await storeRequest(db, company.id);
    const id = await storeWebhook(db);
    await db.insert(webhookDelivery).values([
      { webhookId: id, requestId, status: 'pending', attempts: 2 },
      { webhookId: id, requestId, status: 'delivered', attempts: 1 },
    ]);

    expect(await setWebhookOn(ctx, admin, { webhook: id, on: false })).toEqual({ changed: true });

    expect(await getWebhook(ctx, admin, { webhook: id })).toMatchObject({
      on: false,
      offReason: 'manual',
    });
    const statuses = await db.select({ status: webhookDelivery.status }).from(webhookDelivery);
    expect(statuses.map(({ status }) => status).sort()).toEqual(['cancelled', 'delivered']);
    expect(await setWebhookOn(ctx, admin, { webhook: id, on: false })).toEqual({ changed: false });
    expect(await webhookEvents()).toEqual([
      {
        action: 'webhook_turned_off',
        details: {
          staff: true,
          webhook: 'Adiutor Tests hook',
          host: 'hooks.adiutor.test',
          reason: 'manual',
        },
      },
    ]);
  });

  it('turns it on again with a clean slate', async () => {
    const id = await storeWebhook(db, {
      off: { at: new Date(), reason: 'failing' },
      failingSince: new Date(Date.now() - 4 * 24 * 60 * 60_000),
    });

    expect(await setWebhookOn(ctx, admin, { webhook: id, on: true })).toEqual({ changed: true });

    expect(await readWebhook(db, id)).toMatchObject({
      turnedOffAt: null,
      turnedOffReason: null,
      turnedOffBy: null,
      failingSince: null,
    });
    expect((await webhookEvents()).map(({ action }) => action)).toEqual(['webhook_turned_on']);
  });

  it('refuses to turn on a webhook whose address or secret can’t be read any more', async () => {
    const id = await storeWebhook(db, { off: { at: new Date(), reason: 'unreadable' } });
    await db
      .update(webhook)
      .set({ secretSealed: 'sealed-with-a-dropped-secret' })
      .where(eq(webhook.id, id));

    await expect(setWebhookOn(ctx, admin, { webhook: id, on: true })).rejects.toMatchObject({
      code: 'invalid',
      key: 'errors.webhooks.unreadable',
    });
    expect(await getWebhook(ctx, admin, { webhook: id })).toMatchObject({ on: false });
  });
});

describe('removeWebhook', () => {
  it('removes a webhook with its deliveries, and records it', async () => {
    const company = await createCompany(db);
    const { id: requestId } = await storeRequest(db, company.id);
    const id = await storeWebhook(db, { types: ['bug'] });
    await db.insert(webhookDelivery).values({ webhookId: id, requestId });

    expect(await removeWebhook(ctx, admin, { webhook: id })).toEqual({
      name: 'Adiutor Tests hook',
    });

    expect(await db.select().from(webhook)).toEqual([]);
    expect(await db.select().from(webhookDelivery)).toEqual([]);
    expect(await webhookEvents()).toEqual([
      {
        action: 'webhook_removed',
        details: { staff: true, webhook: 'Adiutor Tests hook', host: 'hooks.adiutor.test' },
      },
    ]);
  });
});
