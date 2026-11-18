/**
 * @file Integration tests for changing a request's title, type and priority:
 * what the editor changed is saved, what they left alone keeps a colleague's
 * change, and two changes of the same detail don't overwrite each other.
 * Which roles may change them is in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { request } from '@/db/schema';
import { REQUEST_TITLE_MAX_LENGTH } from '@/lib/input-rules';

import {
  atTheSameMoment,
  createCompany,
  fillRateLimitBucket,
  minutesAgo,
  staffActor,
} from '../../../tests/integration/helpers';
import { RATE_LIMITS } from '../rate-limit';
import updateRequestDetails from './details';
import { changesOf, ctx, db, storeRequest, storedRequest } from './test-helpers';

/** The details of a stored request: what its form shows, and sends back when nothing is changed. */
const SAME = { title: 'The printer is broken', type: 'bug', priority: 'normal' } as const;

/**
 * What the form of a stored request sends: its details with what the editor
 * changed, and the details it started from.
 *
 * @param change - What the editor changed.
 * @returns The fields, without the request.
 */
const edited = (change: Partial<Record<keyof typeof SAME, string>> = {}) => ({
  ...SAME,
  ...change,
  was: SAME,
});

describe('updateRequestDetails', () => {
  it('changes the title, type and priority, each with a line in the history', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, {
      title: 'Help',
      lastActivityAt: minutesAgo(60),
    });

    const result = await updateRequestDetails(ctx, support, {
      request: String(raised.number),
      title: '  The printer on floor 2 is broken ',
      type: 'hotfix',
      priority: 'high',
      was: { ...SAME, title: 'Help' },
    });

    expect(result).toEqual({ changed: 3 });
    expect(await storedRequest(raised.id)).toMatchObject({
      title: 'The printer on floor 2 is broken',
      type: 'hotfix',
      priority: 'high',
    });
    expect(await changesOf(raised.id)).toEqual([
      ['title', 'Help', 'The printer on floor 2 is broken', 'staff'],
      ['type', 'bug', 'hotfix', 'staff'],
      ['priority', 'normal', 'high', 'staff'],
    ]);
    expect((await storedRequest(raised.id))?.lastActivityAt.getTime()).toBeGreaterThan(
      minutesAgo(1).getTime(),
    );
  });

  it('changes nothing, and adds nothing to the history, when the details are the same', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const at = minutesAgo(60);
    const raised = await storeRequest(company.id, { lastActivityAt: at });

    const result = await updateRequestDetails(ctx, support, { ...edited(), request: raised.id });

    expect(result).toEqual({ changed: 0 });
    expect(await changesOf(raised.id)).toEqual([]);
    expect((await storedRequest(raised.id))?.lastActivityAt).toEqual(at);
  });

  it('leaves the priority alone when only the type changes', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await updateRequestDetails(ctx, support, { ...edited({ type: 'hotfix' }), request: raised.id });

    expect(await storedRequest(raised.id)).toMatchObject({ type: 'hotfix', priority: 'normal' });
    expect(await changesOf(raised.id)).toEqual([['type', 'bug', 'hotfix', 'staff']]);
  });

  it('does not count a change of the priority alone as activity: the company does not see it', async () => {
    const company = await createCompany(db);
    const manager = await staffActor(db, 'manager');
    const at = minutesAgo(60);
    const raised = await storeRequest(company.id, { lastActivityAt: at });

    const result = await updateRequestDetails(ctx, manager, {
      ...edited({ priority: 'low' }),
      request: raised.id,
    });

    expect(result).toEqual({ changed: 1 });
    expect(await storedRequest(raised.id)).toMatchObject({ priority: 'low', lastActivityAt: at });
  });

  it.each([
    ['no title', { title: ' ' }],
    ['a title of two lines', { title: 'The printer\nis broken' }],
    ['an unknown type', { type: 'question' }],
    ['an unknown priority', { priority: 'urgent' }],
    ['no priority', { priority: '' }],
  ])('refuses %s', async (_name, change) => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await expect(
      updateRequestDetails(ctx, support, { ...edited(change), request: raised.id }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await changesOf(raised.id)).toEqual([]);
  });

  it('refuses a change to a request of a deactivated company', async () => {
    const company = await createCompany(db, { deactivated: true });
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await expect(
      updateRequestDetails(ctx, support, {
        ...edited({ title: 'Another title' }),
        request: raised.id,
      }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.companyDeactivated' });
    expect(await storedRequest(raised.id)).toMatchObject({ title: 'The printer is broken' });
  });

  it('stops at the limit of changes one person makes', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await fillRateLimitBucket(
      db,
      `request-change:user:${support.id}`,
      RATE_LIMITS.requestChangesPerUser.limit,
    );

    await expect(
      updateRequestDetails(ctx, support, {
        ...edited({ title: 'Another title' }),
        request: raised.id,
      }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await storedRequest(raised.id)).toMatchObject({ title: 'The printer is broken' });
  });
});

describe('updateRequestDetails: a colleague changed the request meanwhile', () => {
  it('keeps their change to a detail the editor left alone', async () => {
    const company = await createCompany(db);
    const [alex, robin] = [await staffActor(db, 'support'), await staffActor(db, 'manager')];
    const raised = await storeRequest(company.id, { title: 'The printr is broken' });
    // What both their pages show.
    const seen = { ...SAME, title: 'The printr is broken' };

    await updateRequestDetails(ctx, robin, {
      ...seen,
      priority: 'high',
      was: seen,
      request: raised.id,
    });
    // Alex's page still shows Normal; they only fix the typo.
    const result = await updateRequestDetails(ctx, alex, {
      ...seen,
      title: 'The printer is broken',
      was: seen,
      request: raised.id,
    });

    expect(result).toEqual({ changed: 1 });
    expect(await storedRequest(raised.id)).toMatchObject({
      title: 'The printer is broken',
      priority: 'high',
    });
    // One line for the title, and none that says Alex changed the priority.
    expect(await changesOf(raised.id)).toEqual([
      ['priority', 'normal', 'high', 'staff'],
      ['title', 'The printr is broken', 'The printer is broken', 'staff'],
    ]);
  });

  it('keeps a change that is made while the editor’s own waits for it', async () => {
    const company = await createCompany(db);
    const alex = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, { title: 'The printr is broken' });
    const seen = { ...SAME, title: 'The printr is broken' };

    // A colleague's change holds the request; Alex's title fix waits for it, then goes on.
    const { second } = await atTheSameMoment(
      db,
      async (tx) => {
        await tx.update(request).set({ priority: 'high' }).where(eq(request.id, raised.id));
      },
      () =>
        updateRequestDetails(ctx, alex, {
          ...seen,
          title: 'The printer is broken',
          was: seen,
          request: raised.id,
        }),
    );

    expect(second).toMatchObject({ status: 'fulfilled', value: { changed: 1 } });
    expect(await storedRequest(raised.id)).toMatchObject({
      title: 'The printer is broken',
      priority: 'high',
    });
  });

  it('refuses to change a detail they changed to something else, and saves nothing', async () => {
    const company = await createCompany(db);
    const [alex, robin] = [await staffActor(db, 'support'), await staffActor(db, 'manager')];
    const at = minutesAgo(60);
    const raised = await storeRequest(company.id, { lastActivityAt: at });

    await updateRequestDetails(ctx, robin, { ...edited({ priority: 'high' }), request: raised.id });
    // Alex saw Normal and chose Low, and corrected the title in the same save.
    await expect(
      updateRequestDetails(ctx, alex, {
        ...edited({ title: 'The printer on floor 2 is broken', priority: 'low' }),
        request: raised.id,
      }),
    ).rejects.toMatchObject({ code: 'conflict', key: 'errors.requests.detailsChanged' });

    expect(await storedRequest(raised.id)).toMatchObject({
      title: 'The printer is broken',
      priority: 'high',
      lastActivityAt: at,
    });
    expect(await changesOf(raised.id)).toEqual([['priority', 'normal', 'high', 'staff']]);
  });

  it('counts the priority a new type brought as the editor’s choice', async () => {
    const company = await createCompany(db);
    const [alex, robin] = [await staffActor(db, 'support'), await staffActor(db, 'manager')];
    const raised = await storeRequest(company.id);

    await updateRequestDetails(ctx, robin, { ...edited({ priority: 'low' }), request: raised.id });
    // The form moved the priority to the hotfix's own when Alex picked the type.
    await expect(
      updateRequestDetails(ctx, alex, {
        ...edited({ type: 'hotfix', priority: 'high' }),
        request: raised.id,
      }),
    ).rejects.toMatchObject({ code: 'conflict', key: 'errors.requests.detailsChanged' });

    expect(await storedRequest(raised.id)).toMatchObject({ type: 'bug', priority: 'low' });
  });

  it('has nothing left to do when they made the same change', async () => {
    const company = await createCompany(db);
    const [alex, robin] = [await staffActor(db, 'support'), await staffActor(db, 'manager')];
    const raised = await storeRequest(company.id);

    await updateRequestDetails(ctx, robin, { ...edited({ priority: 'high' }), request: raised.id });
    const result = await updateRequestDetails(ctx, alex, {
      ...edited({ priority: 'high' }),
      request: raised.id,
    });

    expect(result).toEqual({ changed: 0 });
    expect(await changesOf(raised.id)).toEqual([['priority', 'normal', 'high', 'staff']]);
  });

  it('changes nothing when the form sends back what it started from, whatever they changed', async () => {
    const company = await createCompany(db);
    const [alex, robin] = [await staffActor(db, 'support'), await staffActor(db, 'manager')];
    const raised = await storeRequest(company.id);
    const theirs = { title: 'The printer on floor 2 is broken', type: 'hotfix', priority: 'high' };

    await updateRequestDetails(ctx, robin, { ...edited(theirs), request: raised.id });
    const result = await updateRequestDetails(ctx, alex, { ...edited(), request: raised.id });

    expect(result).toEqual({ changed: 0 });
    expect(await storedRequest(raised.id)).toMatchObject(theirs);
    expect(await changesOf(raised.id)).toHaveLength(3);
  });
});

describe('updateRequestDetails: what the editor left alone', () => {
  it('is not a change for the spaces a form adds around a title', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    const result = await updateRequestDetails(ctx, support, {
      ...edited({ title: ' The printer is broken  ' }),
      request: raised.id,
    });

    expect(result).toEqual({ changed: 0 });
    expect(await changesOf(raised.id)).toEqual([]);
  });

  it('is not held to the rules: a title that is too long by now stays until someone corrects it', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const tooLong = 'a'.repeat(REQUEST_TITLE_MAX_LENGTH + 1);
    const raised = await storeRequest(company.id, { title: tooLong });
    const seen = { ...SAME, title: tooLong };

    // The priority alone: the title isn't the editor's to answer for.
    expect(
      await updateRequestDetails(ctx, support, {
        ...seen,
        priority: 'high',
        was: seen,
        request: raised.id,
      }),
    ).toEqual({ changed: 1 });
    // A title they do change has to fit.
    await expect(
      updateRequestDetails(ctx, support, {
        ...seen,
        title: `${tooLong}a`,
        was: seen,
        request: raised.id,
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(
      await updateRequestDetails(ctx, support, {
        ...seen,
        title: 'The printer is broken',
        was: seen,
        request: raised.id,
      }),
    ).toEqual({ changed: 1 });
    expect(await storedRequest(raised.id)).toMatchObject({
      title: 'The printer is broken',
      priority: 'high',
    });
  });

  it('treats a form without the values it started from as behind on whatever it would change', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    const nothing = { title: '', type: '', priority: '' };

    // What it sends is what the request has: nothing to do.
    expect(
      await updateRequestDetails(ctx, support, { ...SAME, was: nothing, request: raised.id }),
    ).toEqual({ changed: 0 });
    // What it would change can't be told from what its editor saw.
    await expect(
      updateRequestDetails(ctx, support, {
        ...SAME,
        priority: 'high',
        was: nothing,
        request: raised.id,
      }),
    ).rejects.toMatchObject({ code: 'conflict', key: 'errors.requests.detailsChanged' });
    expect(await changesOf(raised.id)).toEqual([]);
  });
});
