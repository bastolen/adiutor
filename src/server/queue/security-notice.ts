/**
 * @file The queued security notice (`security-notice`): the email telling a
 * user about a security change on their account, sent at the next tick, so a
 * mail outage retries it instead of losing it. Its payload holds IDs and
 * small settings only: the recipient, what changed, and the audit event of
 * the change when the email may show its device (the user's own change).
 * Names and addresses are read when it's sent. Queue it with
 * `queueSecurityNotice` (`src/server/auth/security-notices.ts`).
 */
import { z } from 'zod';

import { ROLE_IDS } from '@/lib/authz/roles';
import { SECURITY_NOTICE_KINDS } from '@/lib/security-notice-kinds';

import { defineQueuedKind } from './define';

/** The longest provider ID a notice accepts. */
const PROVIDER_ID_MAX_LENGTH = 64;

/** The queued security notice: what it carries, checked when it's queued and when it's sent. */
export const securityNoticeJob = defineQueuedKind({
  name: 'security-notice',
  payload: z.object({
    /** The user to tell. */
    userId: z.uuid(),
    /** What changed. */
    kind: z.enum(SECURITY_NOTICE_KINDS),
    /**
     * The change's audit event, for the user's own changes: the email names
     * its device, IP address and time. `null` for anyone else's change.
     */
    auditEventId: z.uuid().nullable(),
    /** The provider, for connected/disconnected, e.g. `github`. */
    providerId: z.string().max(PROVIDER_ID_MAX_LENGTH).nullable(),
    /** The role, for staff and company role changes. */
    role: z.enum(ROLE_IDS).nullable(),
    /** The company, for company role changes and removals. */
    companyId: z.uuid().nullable(),
    /** The staff member who signed in as the user. */
    staffUserId: z.uuid().nullable(),
  }),
});

/** A queued security notice's payload. */
export type SecurityNoticePayload = z.infer<typeof securityNoticeJob.payload>;
