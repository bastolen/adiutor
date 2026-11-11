/**
 * @file Whether a form that gives a role must ask the user to confirm it's
 * them before it's sent: the role needs a recent confirmation
 * (`grantNeedsConfirmation`) and the page's window is closed
 * (`RecentConfirmationProvider`). The note shown instead of the submit
 * button is `people.confirmBeforeGrant`.
 */
'use client';

import { useRecentConfirmation } from '@/components/auth/recent-confirmation';
import { grantNeedsConfirmation } from '@/lib/authz/guards';
import { isRole } from '@/lib/authz/roles';

/**
 * Checks whether a role grant must be confirmed before it's sent.
 *
 * @param companyId - The company, or `null` for the staff.
 * @param role - The chosen role (as the form has it).
 * @returns Whether to show `ConfirmFirstNote` instead of sending.
 */
export default function useConfirmBeforeGrant(companyId: string | null, role: string): boolean {
  const { mustConfirm } = useRecentConfirmation();
  return (
    mustConfirm &&
    isRole(role) &&
    grantNeedsConfirmation({
      target: companyId === null ? { type: 'staff' } : { type: 'company' },
      role,
    })
  );
}
