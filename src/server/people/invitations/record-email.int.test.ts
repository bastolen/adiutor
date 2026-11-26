/**
 * @file Integration test for when an invitation's email is rendered: only
 * once its transaction has committed (`renderEmail`), so no locks are held
 * while React renders it.
 */
import { describe, expect, it, vi } from 'vitest';

import { invitationEmail } from '@/emails/invitation';

import {
  createCompany,
  createStaffSettings,
  memberActor,
  setupTestContext,
} from '../../../../tests/integration/helpers';
import { loadEmailBrand } from '../../branding';
import { createSentInvitation } from './record';

vi.mock('@/emails/invitation', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/emails/invitation')>();
  // The real template, watched.
  return { ...original, invitationEmail: vi.fn(original.invitationEmail) };
});

const { ctx, db } = setupTestContext();

describe('an invitation’s email', () => {
  it('is rendered only when asked, after the transaction', async () => {
    await createStaffSettings(db);
    const testCompany = await createCompany(db);
    const companyAdmin = await memberActor(db, testCompany.id, 'admin');

    const created = await db.transaction(async (tx) => {
      const result = await createSentInvitation(ctx, tx, companyAdmin, {
        target: { companyId: testCompany.id, name: testCompany.name },
        email: 'new@adiutor.test',
        role: 'client',
      });
      expect(invitationEmail).not.toHaveBeenCalled();
      return result;
    });
    const email = await created.renderEmail(await loadEmailBrand(db));

    expect(invitationEmail).toHaveBeenCalledOnce();
    expect(email.to).toBe('new@adiutor.test');
    expect(email.subject).toContain(`invited you to join ${testCompany.name} on Adiutor Tests`);
    expect(email.text).toContain('/invite/');
  });
});
