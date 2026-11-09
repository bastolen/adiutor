/**
 * @file Server actions for company memberships: changing roles and removing
 * members, shared by a company's Members page and the user detail page, and
 * adding an existing user, which only the user detail page offers.
 * Invitations and invite links use `invitation-actions.ts`. Messages are in
 * the request's language (`people.actions`).
 */
'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import type { Actor } from '@/server/actor';
import appContext from '@/server/app-context';
import { currentPermissionsOf, getActor } from '@/server/authz';
import { addMember, changeMemberRole, removeMember } from '@/server/people/members';

import { withAccessNotice } from '../access-notices';
import confirmFirstIfNeeded from './confirm-grant';

/**
 * After a change in a company, sends actors who changed their own membership
 * away from a Members page they can no longer see (it would show the 404
 * page): to the company's page while they can still see it, or else to the
 * dashboard, each with a notice (see `src/app/(app)/access-notices.ts`).
 * Staff with rights in every company keep the page, and changes to others
 * don't touch the actor's rights.
 *
 * @param actor - The acting user, as loaded before the change.
 * @param companyId - The company the change was made in.
 */
async function leaveIfMembersPageLost(actor: Actor, companyId: string): Promise<void> {
  if (!Object.hasOwn(actor.memberships, companyId)) {
    return;
  }
  const permissions = await currentPermissionsOf(appContext.db, actor.id, companyId);
  if (permissions.has('members:view')) {
    return;
  }
  redirect(
    permissions.has('company:view')
      ? withAccessNotice(`/companies/${companyId}`, 'company-stepped-down')
      : withAccessNotice('/dashboard', 'left-company'),
  );
}

/**
 * Changes a member's role.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `companyId`, `membershipId` and `role`.
 * @returns Success, or why it failed.
 */
export async function changeRoleAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const companyId = field(formData, 'companyId');
    // Making someone the company's Admin sends the actor to confirm it's them first.
    await confirmFirstIfNeeded(
      formData,
      `/companies/${encodeURIComponent(companyId)}/members`,
      () =>
        changeMemberRole(appContext, actor, {
          companyId,
          membershipId: field(formData, 'membershipId'),
          role: field(formData, 'role'),
        }),
    );
    await leaveIfMembersPageLost(actor, companyId);
    refresh();
    const t = await getTranslations('people.actions');
    return { ok: true, message: t('roleUpdated') };
  });
}

/**
 * Removes a member from the company.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `companyId` and `membershipId`.
 * @returns A confirmation, or why it failed.
 */
export async function removeMemberAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const companyId = field(formData, 'companyId');
    await removeMember(appContext, actor, {
      companyId,
      membershipId: field(formData, 'membershipId'),
    });
    await leaveIfMembersPageLost(actor, companyId);
    refresh();
    const t = await getTranslations('people.actions');
    return { ok: true, message: t('memberRemoved') };
  });
}

/**
 * Adds an existing user to a company with a role, and emails them.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `userId`, `companyId` and `role`.
 * @returns A confirmation, or why it failed.
 */
export async function addMemberAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const userId = field(formData, 'userId');
    await confirmFirstIfNeeded(formData, `/admin/users/${encodeURIComponent(userId)}`, () =>
      addMember(appContext, actor, {
        companyId: field(formData, 'companyId'),
        userId,
        role: field(formData, 'role'),
      }),
    );
    refresh();
    const t = await getTranslations('people.actions');
    // Staff can add themselves from their own page; the email then goes to them.
    return {
      ok: true,
      message: t('memberAdded', { who: userId === actor.id ? 'self' : 'other' }),
    };
  });
}
