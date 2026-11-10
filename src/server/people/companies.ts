/**
 * @file Companies: listing, registering, editing and (de)activating.
 */
import { and, eq, ilike, or, sql } from 'drizzle-orm';

import { company, membership } from '@/db/schema';
import { COMPANY_ADMIN_ROLE } from '@/lib/authz/roles';
import { firstRow } from '@/lib/defined';
import type { Locale } from '@/lib/i18n/locales';
import type { InviteStatus } from '@/lib/invite-status';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { COMPANIES_TABLE, type CompanySort } from '@/lib/tables/tables';
import { companyNameSchema, emailSchema, slugSchema } from '@/lib/validation';

import {
  assertConfirmedForGrant,
  assertPermission,
  assertStillManages,
  type Company,
  getCompanyAccess,
  getGlobalPermissions,
} from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import { withMfaPromotion } from '../auth/mfa-promotion';
import type { ServiceContext } from '../context';
import { isUniqueViolation, notFoundError, ServiceError } from '../errors';
import { orderTerms, paginate, textOrder } from '../pagination';
import { assertInviteSenderLimit } from '../rate-limit';
import containsPattern from '../search';
import { createSentInvitation, visibleStatus } from './invitations';

/**
 * The error for a URL name that's already taken.
 *
 * @returns The error.
 */
function slugTakenError(): ServiceError {
  return new ServiceError('conflict', 'errors.companies.slugTaken');
}

/** What {@link listCompanies} can be asked for: a search, and the table's sort and page. */
export interface ListCompaniesOptions extends Partial<TableState<CompanySort>> {
  /** Text to match against name or URL name. */
  search?: string;
}

/**
 * Lists the companies, for staff, one page at a time.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `company:view` (staff).
 * @param options - Search, sort and page (by default name A to Z, the first page).
 * @returns The page of companies.
 */
export async function listCompanies(
  ctx: ServiceContext,
  actor: Actor,
  options: ListCompaniesOptions = {},
): Promise<Paged<Company>> {
  assertPermission(getGlobalPermissions(actor), 'company:view');
  const { search = '', ...table } = options;
  const state = resolveTableState(COMPANIES_TABLE, table);
  const term = search.trim();
  const pattern = containsPattern(term);
  const where = term ? or(ilike(company.name, pattern), ilike(company.slug, pattern)) : undefined;
  const order =
    state.sort === 'added'
      ? orderTerms(state.dir, company.createdAt, company.id)
      : orderTerms(state.dir, textOrder(company.name), company.id);
  return paginate(
    state,
    () => ctx.db.$count(company, where),
    (limit, offset) =>
      ctx.db
        .select()
        .from(company)
        .where(where)
        .orderBy(...order)
        .limit(limit)
        .offset(offset),
  );
}

/**
 * Registers a company and invites its first admin by email, in one
 * transaction. Staff see the real invitation status. The transaction first
 * checks the actor's `company:create` again as it is by then
 * (`assertStillManages`), so staff demoted, removed or deactivated while the
 * request was under way can't register a company and invite its Admin.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `company:create`.
 * @param input - Form input.
 * @param input.name - Company name.
 * @param input.slug - URL name; must be unique.
 * @param input.adminEmail - Email address of the company's first admin.
 * @param input.locale - The language of their invitation; by default the request's, else English
 *   (US). An Admin who has an account with a saved language gets that instead.
 * @returns The new company's ID and URL name, and the invitation status.
 * @throws {ServiceError} `forbidden` without `company:create` (also when it's gone by the time the
 *   change is made), `rate_limited` when the actor has sent too many invitations
 *   (`RATE_LIMITS.invitesPerUser`), `conflict` when the URL name is taken.
 */
export async function registerCompany(
  ctx: ServiceContext,
  actor: Actor,
  input: { name: string; slug: string; adminEmail: string; locale?: Locale },
): Promise<{ companyId: string; slug: string; inviteStatus: InviteStatus }> {
  assertPermission(getGlobalPermissions(actor), 'company:create');
  const name = companyNameSchema.parse(input.name);
  const slug = slugSchema.parse(input.slug);
  const adminEmail = emailSchema.parse(input.adminEmail);
  // Its first Admin gets the company's Admin role, which needs a recent confirmation.
  assertConfirmedForGrant(actor, { target: { type: 'company' }, role: COMPANY_ADMIN_ROLE });
  // The first Admin's invitation is an email sent to someone else, like any invitation.
  await assertInviteSenderLimit(ctx, actor.id);

  try {
    const { created, invitation } = await ctx.db.transaction(async (tx) => {
      // The rights the actor was loaded with may be gone by now: only their row as locked counts.
      await assertStillManages(tx, actor, null, 'company:create');
      const inserted = firstRow(
        await tx.insert(company).values({ name, slug, createdBy: actor.id }).returning(),
        'the new company',
      );
      await recordEvent(
        ctx,
        {
          action: 'company_created',
          actorUserId: actor.id,
          companyId: inserted.id,
          details: { name, slug },
        },
        tx,
      );
      const invited = await createSentInvitation(ctx, tx, actor, {
        target: { companyId: inserted.id, name: inserted.name },
        email: adminEmail,
        role: COMPANY_ADMIN_ROLE,
        locale: input.locale,
      });
      return { created: inserted, invitation: invited };
    });
    // Rendered only now, once the transaction has committed and released its locks.
    await ctx.sendEmail(await invitation.renderEmail());
    return {
      companyId: created.id,
      slug: created.slug,
      inviteStatus: visibleStatus(actor, invitation.status),
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw slugTakenError();
    }
    throw error;
  }
}

/**
 * Changes a company's name and URL name. A new URL name changes the
 * company's address (`/companies/<URL name>`; its ID keeps working).
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `company:update` in the company.
 * @param input - Form input.
 * @param input.companyId - The company.
 * @param input.name - New name.
 * @param input.slug - New URL name; must be unique.
 * @returns The URL name now, and whether it changed (so the page can move to the new address).
 */
export async function updateCompany(
  ctx: ServiceContext,
  actor: Actor,
  input: { companyId: string; name: string; slug: string },
): Promise<{ slug: string; slugChanged: boolean }> {
  const access = await getCompanyAccess(ctx.db, actor, input.companyId);
  assertPermission(access.permissions, 'company:update');
  const name = companyNameSchema.parse(input.name);
  const slug = slugSchema.parse(input.slug);
  try {
    await ctx.db.update(company).set({ name, slug }).where(eq(company.id, access.company.id));
    await recordEvent(ctx, {
      action: 'company_updated',
      actorUserId: actor.id,
      companyId: access.company.id,
      details: {
        from: { name: access.company.name, slug: access.company.slug },
        to: { name, slug },
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw slugTakenError();
    }
    throw error;
  }
  return { slug, slugChanged: slug !== access.company.slug };
}

/**
 * Deactivates or reactivates a company. While deactivated, its members
 * can't use it; nothing is deleted. Reactivating makes MFA required again
 * for its Admins, so their sessions without it end (`withMfaPromotion`).
 *
 * The transaction first locks the company's row (`FOR NO KEY UPDATE`; company
 * rows come first in the lock order, see `docs/security-measures.md`) and
 * refuses a company that's already in that state (e.g. deactivated by
 * someone else since the page was opened), so the audit log records only
 * real changes and the first deactivation's date stays.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `company:deactivate` in the company.
 * @param input - Which company and what to do.
 * @param input.companyId - The company.
 * @param input.active - `true` to reactivate, `false` to deactivate.
 * @throws {ServiceError} `conflict` when the company is already deactivated, or already active;
 *   `not_found` when it's gone.
 */
export async function setCompanyActive(
  ctx: ServiceContext,
  actor: Actor,
  input: { companyId: string; active: boolean },
): Promise<void> {
  const access = await getCompanyAccess(ctx.db, actor, input.companyId);
  assertPermission(access.permissions, 'company:deactivate');
  await ctx.db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ deactivatedAt: company.deactivatedAt })
      .from(company)
      .where(eq(company.id, access.company.id))
      .for('no key update');
    if (!locked) {
      throw notFoundError();
    }
    if ((locked.deactivatedAt === null) === input.active) {
      throw new ServiceError(
        'conflict',
        input.active ? 'errors.companies.alreadyActive' : 'errors.companies.alreadyDeactivated',
      );
    }
    const admins = await tx
      .select({ userId: membership.userId })
      .from(membership)
      .where(
        and(eq(membership.companyId, access.company.id), eq(membership.role, COMPANY_ADMIN_ROLE)),
      );
    await withMfaPromotion(
      ctx,
      tx,
      admins.map((admin) => admin.userId),
      async () => {
        await tx
          .update(company)
          .set({ deactivatedAt: input.active ? null : sql`now()` })
          .where(eq(company.id, access.company.id));
        await recordEvent(
          ctx,
          {
            action: input.active ? 'company_reactivated' : 'company_deactivated',
            actorUserId: actor.id,
            companyId: access.company.id,
            details: { name: access.company.name },
          },
          tx,
        );
      },
      { companyId: access.company.id },
    );
  });
}
