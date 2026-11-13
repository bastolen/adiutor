/**
 * @file The queued emails about people joining: "you were added to a
 * company" (`added-to-company`) and "someone became a staff Admin"
 * (`staff-admin-added`, one job per staff Admin to tell, so a refusal for one
 * never sends the others theirs twice). Their payloads hold IDs and the role
 * only; names and addresses are read when they're sent.
 */
import { z } from 'zod';

import { COMPANY_ROLES } from '@/lib/authz/roles';

import { defineQueuedKind } from './define';

/** The "you were added to a company" email: queue it once the member is added. */
export const addedToCompanyJob = defineQueuedKind({
  name: 'added-to-company',
  payload: z.object({
    /** The member who was added. */
    userId: z.uuid(),
    /** The company. */
    companyId: z.uuid(),
    /** The role they were given. */
    role: z.enum(COMPANY_ROLES),
    /** The staff member who added them. */
    addedBy: z.uuid(),
  }),
});

/** The "someone became a staff Admin" email to one staff Admin. */
export const staffAdminAddedJob = defineQueuedKind({
  name: 'staff-admin-added',
  // Tells the other staff Admins about a new one, so nobody may silence it.
  pausable: false,
  payload: z.object({
    /** The staff Admin to tell. */
    recipientId: z.uuid(),
    /** The new staff Admin. */
    newAdminId: z.uuid(),
    /** Given the role by a staff Admin (`role`), or joined from an invitation or link (`invitation`). */
    how: z.enum(['role', 'invitation']),
    /** Who gave the role, sent the invitation or created the link, if their account still existed. */
    byUserId: z.uuid().nullable(),
  }),
});
