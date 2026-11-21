/**
 * @file Integration tests for the user's own choice whether they get emails
 * about requests: on by default, also for an account from before the
 * setting, and saved for themselves only. That it's refused while a staff
 * member is signed in as them is in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { user } from '@/db/schema';

import { createCompany, memberActor, setupTestContext } from '../../../tests/integration/helpers';
import { ownRequestEmails, setOwnRequestEmails } from './request-emails';

const { ctx, db } = setupTestContext();

describe('emails about requests, in the user’s own account', () => {
  it('are on until the user turns them off, and on again when they turn them on', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const colleague = await memberActor(db, company.id, 'client');

    expect(await ownRequestEmails(ctx, client)).toBe(true);
    expect(await setOwnRequestEmails(ctx, client, false)).toBe(false);
    expect(await ownRequestEmails(ctx, client)).toBe(false);
    // Only their own.
    expect(await ownRequestEmails(ctx, colleague)).toBe(true);

    await setOwnRequestEmails(ctx, client, true);
    expect(await ownRequestEmails(ctx, client)).toBe(true);
  });

  it('count as on for an account from before the setting', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    await db.update(user).set({ requestEmails: null }).where(eq(user.id, client.id));

    expect(await ownRequestEmails(ctx, client)).toBe(true);
  });
});
