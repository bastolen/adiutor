/**
 * @file Server actions for invitations and invite links, shared by a
 * company's Members page and the staff page. The `companyId` field is empty
 * for staff. Each action checks the session and lets the service check
 * permissions (`members:manage` or `staff:manage`), then refreshes the page.
 */
'use server';

import { refresh } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import field, { localeField } from '@/lib/form-data';
import inviteStatusMessage from '@/lib/invite-status';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { inviteManyByEmail, resendInvitation, revokeInvitation } from '@/server/people/invitations';
import { createInviteLink, revokeInviteLink } from '@/server/people/invite-links';

import confirmFirstIfNeeded from './confirm-grant';

/**
 * Reads the target from a form: a company ID, or `null` (empty field) for
 * the staff.
 *
 * @param formData - The submitted form.
 * @returns The company ID, or `null`.
 */
function targetField(formData: FormData): string | null {
  return field(formData, 'companyId') || null;
}

/**
 * The page the invitations of a target are managed on, to come back to after
 * confirming it's you: the staff page, or the company's Members page.
 *
 * @param companyId - The company, or `null` for the staff.
 * @returns The page's path.
 */
function targetPage(companyId: string | null): string {
  return companyId ? `/companies/${encodeURIComponent(companyId)}/members` : '/admin/staff';
}

/** One address in the result of {@link inviteAction}. */
interface InviteResultLine {
  /** The address. */
  email: string;
  /** Whether its invitation was sent. */
  ok: boolean;
  /** What happened, e.g. "Invitation sent to jane@adiutor.dev.". */
  message: string;
}

/**
 * Invites one or more people by email (up to 20), all with the same role.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `companyId`, `emails`, `role` and `locale` (the emails' language).
 * @returns A summary with a line per address, or why it failed.
 */
export async function inviteAction(
  _previous: ActionResult<{ lines: InviteResultLine[] }> | null,
  formData: FormData,
): Promise<ActionResult<{ lines: InviteResultLine[] }>> {
  return runAction(async () => {
    const actor = await getActor();
    const companyId = targetField(formData);
    // A staff role, or a company's Admin role, sends the actor to confirm it's them first.
    const results = await confirmFirstIfNeeded(formData, targetPage(companyId), () =>
      inviteManyByEmail(appContext, actor, {
        companyId,
        emails: field(formData, 'emails'),
        role: field(formData, 'role'),
        locale: localeField(formData),
      }),
    );
    refresh();
    const lines = results.map((result) => ({
      email: result.email,
      ok: result.ok,
      message: result.ok ? inviteStatusMessage(result.email, result.status) : result.message,
    }));
    const sent = lines.filter((line) => line.ok).length;
    const [only] = lines;
    if (only && lines.length === 1) {
      return only.ok ? { ok: true, message: only.message } : { ok: false, message: only.message };
    }
    const summary =
      sent === lines.length
        ? `Sent ${sent} invitations.`
        : `Sent ${sent} of ${lines.length} invitations. Check the addresses below.`;
    return { ok: true, message: summary, data: { lines } };
  });
}

/**
 * Creates a single-use invite link.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `companyId`, `role` and `validDays`.
 * @returns The link (shown once), or why it failed.
 */
export async function createInviteLinkAction(
  _previous: ActionResult<{ url: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const actor = await getActor();
    const companyId = targetField(formData);
    const { url } = await confirmFirstIfNeeded(formData, targetPage(companyId), () =>
      createInviteLink(appContext, actor, {
        companyId,
        role: field(formData, 'role'),
        validDays: Number(field(formData, 'validDays')),
      }),
    );
    refresh();
    return { ok: true, data: { url } };
  });
}

/**
 * Revokes an invite link.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `companyId` and `linkId`.
 * @returns A confirmation, or why it failed.
 */
export async function revokeInviteLinkAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await revokeInviteLink(appContext, actor, {
      companyId: targetField(formData),
      linkId: field(formData, 'linkId'),
    });
    refresh();
    return { ok: true, message: 'Invite link revoked.' };
  });
}

/**
 * Resends an invitation with a fresh link.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `companyId` and `invitationId`.
 * @returns A confirmation, or why it failed.
 */
export async function resendInvitationAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const companyId = targetField(formData);
    await confirmFirstIfNeeded(formData, targetPage(companyId), () =>
      resendInvitation(appContext, actor, {
        companyId,
        invitationId: field(formData, 'invitationId'),
      }),
    );
    refresh();
    return { ok: true, message: 'Sent again.' };
  });
}

/**
 * Revokes an invitation.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `companyId` and `invitationId`.
 * @returns A confirmation, or why it failed.
 */
export async function revokeInvitationAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await revokeInvitation(appContext, actor, {
      companyId: targetField(formData),
      invitationId: field(formData, 'invitationId'),
    });
    refresh();
    return { ok: true, message: 'Invitation revoked.' };
  });
}
