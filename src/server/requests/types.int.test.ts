/**
 * @file Integration tests for request types: the built-in ones a fresh
 * install has, what every reader gets, and staff Admins adding, editing,
 * moving, archiving and restoring types. Which roles may manage them is in
 * the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { requestType } from '@/db/schema';

import {
  createCompany,
  memberActor,
  staffActor,
  auditEvents,
} from '../../../tests/integration/helpers';
import { getRequest } from './detail';
import updateRequestDetails from './details';
import { listRequests } from './list';
import { ctx, db, storeRequest, storeRequestType } from './test-helpers';
import {
  addRequestType,
  archiveRequestType,
  listRequestTypes,
  moveRequestType,
  restoreRequestType,
  updateRequestType,
} from './types';

/**
 * The keys of every type, in their order.
 *
 * @returns The keys.
 */
async function order() {
  const rows = await db
    .select({ key: requestType.key })
    .from(requestType)
    .orderBy(requestType.position);
  return rows.map(({ key }) => key);
}

/**
 * The audit events' actions and details, oldest first.
 *
 * @returns Each event.
 */
async function events() {
  return auditEvents(db, { fields: ['action', 'details'] });
}

describe('the request types to begin with', () => {
  it('are the four that were built in, with their keys and starting priorities', async () => {
    const admin = await staffActor(db, 'platform_admin');

    expect(await listRequestTypes(ctx, admin)).toEqual([
      expect.objectContaining({ key: 'hotfix', name: 'Hotfix', startingPriority: 'high' }),
      expect.objectContaining({ key: 'bug', name: 'Bug', startingPriority: 'normal' }),
      expect.objectContaining({ key: 'support', name: 'Support', startingPriority: 'normal' }),
      expect.objectContaining({ key: 'new_feature', startingPriority: 'low', archived: false }),
    ]);
  });

  it('come without their starting priorities for someone at a company', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');

    const types = await listRequestTypes(ctx, client);
    expect(types).toHaveLength(4);
    types.forEach((type) => expect(type.startingPriority).toBeNull());
  });
});

describe('managing request types', () => {
  it('adds a type at the end, with a key made from its name, and records it', async () => {
    const admin = await staffActor(db, 'platform_admin');

    const added = await addRequestType(ctx, admin, {
      name: ' Printers ',
      description: 'A printer acts up.',
      startingPriority: 'high',
    });
    // A second type with the same name gets a key of its own.
    const again = await addRequestType(ctx, admin, {
      name: 'Printers',
      description: 'Another printer.',
      startingPriority: 'low',
    });

    expect(added).toEqual({ key: 'printers' });
    expect(again).toEqual({ key: 'printers_2' });
    expect(await order()).toEqual([
      'hotfix',
      'bug',
      'support',
      'new_feature',
      'printers',
      'printers_2',
    ]);
    expect((await events())[0]).toEqual({
      action: 'request_type_added',
      details: { type: 'printers', name: 'Printers', startingPriority: 'high' },
    });
  });

  it('edits a type and keeps its key, so its requests keep it', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const raised = await storeRequest(company.id, { type: 'bug' });

    expect(
      await updateRequestType(ctx, admin, {
        type: 'bug',
        name: 'Defect',
        description: 'Something is wrong.',
        startingPriority: 'high',
      }),
    ).toEqual({ changed: true });
    expect(
      await updateRequestType(ctx, admin, {
        type: 'bug',
        name: 'Defect',
        description: 'Something is wrong.',
        startingPriority: 'high',
      }),
    ).toEqual({ changed: false });

    const detail = await getRequest(ctx, admin, raised.id);
    expect(detail).toMatchObject({ type: 'bug', typeName: 'Defect', priority: 'normal' });
    expect(await events()).toEqual([
      {
        action: 'request_type_changed',
        details: {
          type: 'bug',
          from: {
            name: 'Bug',
            description: 'Something doesn’t work as it should.',
            startingPriority: 'normal',
          },
          to: { name: 'Defect', description: 'Something is wrong.', startingPriority: 'high' },
        },
      },
    ]);
  });

  it('moves a type up and down, and leaves the first and last where they are', async () => {
    const admin = await staffActor(db, 'platform_admin');

    expect(await moveRequestType(ctx, admin, { type: 'support', direction: 'up' })).toEqual({
      moved: true,
    });
    expect(await order()).toEqual(['hotfix', 'support', 'bug', 'new_feature']);
    expect(await moveRequestType(ctx, admin, { type: 'hotfix', direction: 'up' })).toEqual({
      moved: false,
    });
    expect(await moveRequestType(ctx, admin, { type: 'new_feature', direction: 'down' })).toEqual({
      moved: false,
    });
    await moveRequestType(ctx, admin, { type: 'hotfix', direction: 'down' });
    expect(await order()).toEqual(['support', 'hotfix', 'bug', 'new_feature']);
    // Moving isn't an audit event: it changes no request.
    expect(await events()).toEqual([]);
  });

  it('archives a type, which its requests keep, and restores it', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const client = await memberActor(db, company.id, 'client');
    await storeRequestType({ key: 'printers' });
    const raised = await storeRequest(company.id, { type: 'printers' });

    expect(await archiveRequestType(ctx, admin, { type: 'printers' })).toEqual({ changed: true });
    expect(await archiveRequestType(ctx, admin, { type: 'printers' })).toEqual({
      changed: false,
    });

    // Still on its request, by name, and in the list's filter.
    expect(await getRequest(ctx, client, raised.id)).toMatchObject({
      type: 'printers',
      typeName: 'Printers',
    });
    const filtered = await listRequests(ctx, client, { status: 'all', type: 'printers' });
    expect(filtered.items.map(({ id }) => id)).toEqual([raised.id]);
    expect((await listRequestTypes(ctx, client)).at(-1)).toMatchObject({
      key: 'printers',
      archived: true,
    });

    expect(await restoreRequestType(ctx, admin, { type: 'printers' })).toEqual({ changed: true });
    expect((await listRequestTypes(ctx, client)).at(-1)).toMatchObject({ archived: false });
    expect((await events()).map(({ action }) => action)).toEqual([
      'request_type_archived',
      'request_type_restored',
    ]);
  });

  it('never archives the last type that isn’t archived', async () => {
    const admin = await staffActor(db, 'platform_admin');
    await db.update(requestType).set({ archivedAt: new Date() }).where(eq(requestType.key, 'bug'));
    await db
      .update(requestType)
      .set({ archivedAt: new Date() })
      .where(eq(requestType.key, 'support'));
    await db
      .update(requestType)
      .set({ archivedAt: new Date() })
      .where(eq(requestType.key, 'new_feature'));

    await expect(archiveRequestType(ctx, admin, { type: 'hotfix' })).rejects.toMatchObject({
      code: 'invalid',
      key: 'errors.requestTypes.lastActive',
    });
  });

  it('names the types in a type change as they’re called now', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, { type: 'bug' });
    await updateRequestDetails(ctx, support, {
      request: raised.id,
      title: 'The printer is broken',
      type: 'hotfix',
      priority: 'normal',
      was: { title: 'The printer is broken', type: 'bug', priority: 'normal' },
    });
    await updateRequestType(ctx, admin, {
      type: 'hotfix',
      name: 'Urgent',
      description: 'It can’t wait.',
      startingPriority: 'high',
    });

    const { entries } = await getRequest(ctx, admin, raised.id);
    expect(entries).toMatchObject([{ kind: 'type', from: 'Bug', to: 'Urgent' }]);
  });

  it.each([
    ['an empty name', { name: ' ' }],
    ['a name that’s too long', { name: 'a'.repeat(41) }],
    ['no explanation', { description: '' }],
    ['a priority that doesn’t exist', { startingPriority: 'urgent' }],
  ])('refuses %s', async (_name, change) => {
    const admin = await staffActor(db, 'platform_admin');

    await expect(
      addRequestType(ctx, admin, {
        name: 'Printers',
        description: 'A printer acts up.',
        startingPriority: 'normal',
        ...change,
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await order()).toHaveLength(4);
  });

  it('says a type that doesn’t exist isn’t found', async () => {
    const admin = await staffActor(db, 'platform_admin');

    await expect(archiveRequestType(ctx, admin, { type: 'printers' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      moveRequestType(ctx, admin, { type: 'bug', direction: 'sideways' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
