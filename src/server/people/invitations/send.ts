/**
 * @file Inviting people by email, one address or many, with the same result for
 * company users whether or not the address has an account.
 */
import { parseEmailList } from '@/lib/email-list';
import type { Locale } from '@/lib/i18n/locales';
import { MAX_BULK_INVITES } from '@/lib/input-rules';
import type { InviteStatus } from '@/lib/invite-status';
import { emailSchema, roleSchema } from '@/lib/validation';

import {
  assertConfirmedForGrant,
  assertStillManagesPeople,
  getTargetAccess,
  assertNotSignedInAs,
} from '../../access';
import type { Actor } from '../../actor';
import type { ServiceContext } from '../../context';
import { concurrentChangeError, isDeadlock, ServiceError } from '../../errors';
import { createSentInvitation } from './record';
import { assertCanManage, assertInvitable, assertInviteRateLimits, visibleStatus } from './rules';

/**
 * Invites someone to a company, or to the staff, by email: the
 * single-address service that {@link inviteManyByEmail} (the forms' bulk
 * invite) runs for each address. Exported for the authorization matrix and
 * the integration tests. The actor's rights are checked again as the first
 * step of the transaction (`assertStillManagesPeople`), before the
 * per-address lock, so an Admin demoted, removed or deactivated while the
 * request was under way can't send it.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `members:manage` in the company, or `staff:manage`.
 * @param input - Form input.
 * @param input.companyId - The company, or `null` for staff.
 * @param input.email - The email address to invite.
 * @param input.role - The role to give.
 * @param input.locale - The invitation's language; by default Adiutor's default language, else
 *   English (US). An invitee who has an account with a saved language gets that instead.
 * @returns The status the actor may see (see {@link visibleStatus}).
 */
export async function inviteByEmail(
  ctx: ServiceContext,
  actor: Actor,
  input: { companyId: string | null; email: string; role: string; locale?: Locale },
): Promise<{ status: InviteStatus }> {
  assertNotSignedInAs(actor);
  const email = emailSchema.parse(input.email);
  const role = roleSchema.parse(input.role);
  const access = await getTargetAccess(ctx.db, actor, input.companyId);
  assertCanManage(access);
  assertInvitable(access, role);
  // A staff role, or a company's Admin role, needs a recent confirmation; before the limits count.
  assertConfirmedForGrant(actor, { target: access.target, role });
  const companyId = access.company?.id ?? null;
  await assertInviteRateLimits(ctx, actor, companyId);

  const created = await ctx.db.transaction(async (tx) => {
    // The rights the actor was loaded with may be gone by now: only their rows as locked count.
    await assertStillManagesPeople(tx, actor, companyId);
    return createSentInvitation(ctx, tx, actor, {
      target: { companyId, name: access.name },
      email,
      role,
      locale: input.locale,
    });
  });
  // Rendered only now, once the transaction has committed and released its locks.
  await ctx.sendEmail(await created.renderEmail());
  return { status: visibleStatus(actor, created.status) };
}

/**
 * The outcome of inviting one address in a bulk invitation: the status the
 * actor may see, or why it was refused (translated where it's shown, with
 * `serviceErrorMessage`).
 */
export type BulkInviteResult =
  | { email: string; ok: true; status: InviteStatus }
  | { email: string; ok: false; error: ServiceError };

/**
 * Invites several addresses with the same role, one after another, so rate
 * limits apply per address. One failing address doesn't stop the others.
 *
 * Whether the actor may invite to the target at all is the same for every
 * address, so it's checked once, before the first one, as
 * {@link inviteByEmail} checks it (`getTargetAccess` and
 * {@link assertCanManage}): a caller who may not invite there gets the same
 * `not_found` or `forbidden` as for one address, with no result per address
 * and no email sent. Other refusals are still reported per address (a limit
 * reached, for example), and so is a deadlock that ended an address's
 * transaction (nothing was sent to it), so the results of the addresses
 * already sent aren't lost. Each address still goes through `inviteByEmail`,
 * which checks the rights again in its transaction
 * (`assertStillManagesPeople`).
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `members:manage`, or `staff:manage` for staff.
 * @param input - Form input.
 * @param input.companyId - The company, or `null` for staff.
 * @param input.emails - The addresses, one per line or separated by commas.
 * @param input.role - The role for all of them.
 * @param input.locale - The invitations' language (see {@link inviteByEmail}).
 * @returns One result per address, in the order typed.
 * @throws {ServiceError} `invalid` when an entry isn't an email address, or
 *   there are none or more than {@link MAX_BULK_INVITES}; `not_found` for a
 *   company the actor can't see; `forbidden` without `members:manage` (company)
 *   or `staff:manage` (staff), also when the rights are gone partway through.
 */
export async function inviteManyByEmail(
  ctx: ServiceContext,
  actor: Actor,
  input: { companyId: string | null; emails: string; role: string; locale?: Locale },
): Promise<BulkInviteResult[]> {
  assertNotSignedInAs(actor);
  const { emails, invalid } = parseEmailList(input.emails);
  if (invalid.length > 0) {
    throw new ServiceError('invalid', 'validation.emailList.invalid', {
      count: invalid.length,
      emails: invalid.join(', '),
    });
  }
  if (emails.length === 0) {
    throw new ServiceError('invalid', 'validation.emailList.empty');
  }
  if (emails.length > MAX_BULK_INVITES) {
    throw new ServiceError('invalid', 'validation.emailList.tooMany', { max: MAX_BULK_INVITES });
  }
  // The same for every address, so refused once, as for one address, not once per address.
  const access = await getTargetAccess(ctx.db, actor, input.companyId);
  assertCanManage(access);
  assertConfirmedForGrant(actor, { target: access.target, role: roleSchema.parse(input.role) });

  const results: BulkInviteResult[] = [];
  await emails.reduce(async (previous, email) => {
    await previous;
    try {
      const { status } = await inviteByEmail(ctx, actor, { ...input, email });
      results.push({ email, ok: true, status });
    } catch (error) {
      // Postgres ended this address's transaction to break a deadlock, so nothing was sent to it:
      // it's reported with the others, keeping the results of those already sent.
      if (isDeadlock(error)) {
        // eslint-disable-next-line no-console -- As in `runAction`: a deadlock points at a transaction that doesn't follow the lock order; no request details.
        console.warn(
          'A bulk invitation hit a database deadlock; that address was reported as a conflict.',
        );
        results.push({ email, ok: false, error: concurrentChangeError() });
        return;
      }
      // Refusals about the actor, not the address, stop the whole list.
      if (
        !(error instanceof ServiceError) ||
        error.code === 'forbidden' ||
        error.code === 'confirmation_required'
      ) {
        throw error;
      }
      results.push({ email, ok: false, error });
    }
  }, Promise.resolve());
  return results;
}
