/**
 * @file Integration tests for dismissing the dashboard's recommendation to add
 * a passkey or two-step verification, saved with the account.
 */
import { describe, expect, it } from 'vitest';

import { defined } from '@/lib/defined';

import { createUser, setupTestContext } from '../../../tests/integration/helpers';
import { loadActor } from '../actor';
import { dismissMfaRecommendation, isMfaRecommendationDismissed } from './mfa-recommendation';

const { ctx, db } = setupTestContext();

describe('dismissMfaRecommendation', () => {
  it('hides the recommendation for the user who dismissed it, and only for them', async () => {
    const jane = defined(await loadActor(db, await createUser(db, 'jane@adiutor.test')), 'Jane');
    const sam = defined(await loadActor(db, await createUser(db, 'sam@adiutor.test')), 'Sam');

    await expect(isMfaRecommendationDismissed(ctx, jane)).resolves.toBe(false);
    await dismissMfaRecommendation(ctx, jane);

    await expect(isMfaRecommendationDismissed(ctx, jane)).resolves.toBe(true);
    await expect(isMfaRecommendationDismissed(ctx, sam)).resolves.toBe(false);
  });

  it('keeps it dismissed when it is dismissed again', async () => {
    const jane = defined(await loadActor(db, await createUser(db, 'jane@adiutor.test')), 'Jane');

    await dismissMfaRecommendation(ctx, jane);
    await dismissMfaRecommendation(ctx, jane);

    await expect(isMfaRecommendationDismissed(ctx, jane)).resolves.toBe(true);
  });
});
