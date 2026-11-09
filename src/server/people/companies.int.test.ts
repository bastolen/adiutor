/**
 * @file Integration tests for registering, listing, renaming and
 * (de)activating companies, and the audit events of the last two.
 */
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { auditEvent, company, invitation, rateLimitBucket, staffSettings, user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import {
  atTheSameMoment,
  createCompany,
  createStaffSettings,
  emailLanguage,
  inLanguage,
  inSequence,
  memberActor,
  setupTestContext,
  staffActor,
} from '../../../tests/integration/helpers';
import { getCompanyAccess } from '../access';
import type { Actor } from '../actor';
import { listCompanies, registerCompany, setCompanyActive, updateCompany } from './companies';
import { listPendingInvitations } from './invitations';
import { RATE_LIMITS } from '../rate-limit';

const { ctx, db, sent } = setupTestContext();

let manager: Actor;

beforeEach(async () => {
  await createStaffSettings(db);
  manager = await staffActor(db, 'manager');
});

describe('registerCompany', () => {
  it('creates a company and invites its first admin', async () => {
    const { companyId, inviteStatus } = await registerCompany(ctx, manager, {
      name: 'Adiutor Tests',
      slug: 'adiutor-tests-client',
      adminEmail: 'Boss@Adiutor.test',
    });
    expect(inviteStatus).toBe('sent');
    expect(sent[0]).toMatchObject({ to: 'boss@adiutor.test' });
    expect(defined(sent[0], 'the invitation email').text).toContain(
      `${manager.name} invited you to join Adiutor Tests on Adiutor as Admin.`,
    );
    expect(defined(sent[0], 'the invitation email').html).toContain('Accept invitation');

    const [pending] = (await listPendingInvitations(ctx, manager, companyId)).items;
    expect(pending).toMatchObject({ email: 'boss@adiutor.test', role: 'admin' });
  });

  it('invites the first admin in the chosen language, or on Default in Adiutor’s default', async () => {
    await db.update(staffSettings).set({ defaultLocale: 'es-ES' });
    await registerCompany(ctx, manager, {
      name: 'Adiutor Tests Dutch',
      slug: 'adiutor-tests-dutch',
      adminEmail: 'nl@adiutor.test',
      locale: 'nl-NL',
    });
    // Default: no language from the form. The sender's own language doesn't count.
    await registerCompany(inLanguage(ctx, 'en-US'), manager, {
      name: 'Adiutor Tests Default',
      slug: 'adiutor-tests-default',
      adminEmail: 'default@adiutor.test',
    });

    expect(sent.map((email) => [email.to, emailLanguage(email)])).toEqual([
      ['nl@adiutor.test', 'nl-NL'],
      ['default@adiutor.test', 'es-ES'],
    ]);
  });

  it('refuses a URL name that is taken', async () => {
    const input = {
      name: 'Adiutor Tests',
      slug: 'adiutor-tests-client',
      adminEmail: 'a@adiutor.test',
    };
    await registerCompany(ctx, manager, input);
    await expect(registerCompany(ctx, manager, input)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('counts the first admin’s invitation against the sender’s invitation limit', async () => {
    // The manager has sent as many invitations this hour as they may.
    await db.insert(rateLimitBucket).values({
      key: `invite:user:${manager.id}`,
      count: RATE_LIMITS.invitesPerUser.limit,
      resetAt: sql`now() + interval '1 hour'`,
    });

    await expect(
      registerCompany(ctx, manager, {
        name: 'Adiutor Tests',
        slug: 'adiutor-tests-client',
        adminEmail: 'boss@adiutor.test',
      }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await db.select().from(company)).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe('registerCompany by staff demoted while the request was under way', () => {
  it('registers nothing and invites nobody', async () => {
    const { second } = await atTheSameMoment(
      db,
      // The demotion commits only once the request is waiting for it.
      (tx) => tx.update(user).set({ platformRole: 'support' }).where(eq(user.id, manager.id)),
      // `manager` still carries the rights it was loaded with before the demotion.
      () =>
        registerCompany(ctx, manager, {
          name: 'Adiutor Tests',
          slug: 'adiutor-tests-client',
          adminEmail: 'boss@adiutor.test',
        }),
    );

    expect(second).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        code: 'forbidden',
        key: 'errors.forbidden',
      }),
    });
    expect(await db.select().from(company)).toEqual([]);
    expect(await db.select().from(invitation)).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe('listing', () => {
  it('shows all companies to staff, matching a search', async () => {
    await createCompany(db, { slug: 'adiutor-tests-one' });
    await createCompany(db, { slug: 'adiutor-tests-two' });
    const support = await staffActor(db, 'support');

    /**
     * Lists the URL names of the companies staff see, sorted.
     *
     * @param search - Optional search text.
     * @returns The URL names.
     */
    const slugs = async (search?: string) =>
      (await listCompanies(ctx, support, { search })).items.map((c) => c.slug).sort();
    expect(await slugs()).toEqual(['adiutor-tests-one', 'adiutor-tests-two']);
    expect(await slugs('TWO')).toEqual(['adiutor-tests-two']);
    expect(await listCompanies(ctx, support, { search: '%' })).toEqual({
      items: [],
      total: 0,
      page: 1,
      size: 25,
    });
  });

  it('sorts by name ignoring case, with same names in a fixed order, and exactly reversed', async () => {
    const names = ['beta', 'Adiutor Tests Alpha', 'gamma', 'Delta', 'Delta'];
    // One at a time, so the two Deltas get IDs in a known order.
    const created = await inSequence(names, (name) => createCompany(db, { name }));
    const [, , , firstDelta, secondDelta] = created;

    /**
     * Lists the companies' IDs in a direction.
     *
     * @param dir - The direction.
     * @returns The IDs, in order.
     */
    const ids = async (dir: 'asc' | 'desc') =>
      (await listCompanies(ctx, manager, { sort: 'name', dir })).items.map((c) => c.id);

    const ascending = await ids('asc');
    expect(ascending).toEqual([
      defined(created[1], 'the second company').id,
      defined(created[0], 'the first company').id,
      defined(firstDelta, 'the first Delta').id,
      defined(secondDelta, 'the second Delta').id,
      defined(created[2], 'the third company').id,
    ]);
    expect(await ids('desc')).toEqual([...ascending].reverse());
    // Name A to Z is the default.
    expect((await listCompanies(ctx, manager)).items.map((c) => c.id)).toEqual(ascending);
  });

  it('sorts by when they were added, newest first by default', async () => {
    const older = await createCompany(db, { name: 'Adiutor Tests Older' });
    const newer = await createCompany(db, { name: 'Adiutor Tests Newer' });
    await db
      .update(company)
      .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(company.id, older.id));

    const byAdded = await listCompanies(ctx, manager, { sort: 'added' });
    expect(byAdded.items.map((c) => c.id)).toEqual([newer.id, older.id]);
    const reversed = await listCompanies(ctx, manager, { sort: 'added', dir: 'asc' });
    expect(reversed.items.map((c) => c.id)).toEqual([older.id, newer.id]);
  });

  it('shows one page at a time, counting all of them, and the last page for one past it', async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        createCompany(db, { name: `Adiutor Tests ${String(index + 1).padStart(2, '0')}` }),
      ),
    );

    const first = await listCompanies(ctx, manager);
    expect(first).toMatchObject({ total: 30, page: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    expect(defined(first.items[0], 'the first company').name).toBe('Adiutor Tests 01');

    const second = await listCompanies(ctx, manager, { page: 2 });
    expect(second).toMatchObject({ total: 30, page: 2 });
    expect(second.items.map((c) => c.name)).toEqual([
      'Adiutor Tests 26',
      'Adiutor Tests 27',
      'Adiutor Tests 28',
      'Adiutor Tests 29',
      'Adiutor Tests 30',
    ]);

    const past = await listCompanies(ctx, manager, { page: 99 });
    expect(past.page).toBe(2);
    expect(past.items.map((c) => c.name)).toEqual(second.items.map((c) => c.name));

    const fifty = await listCompanies(ctx, manager, { size: 50 });
    expect(fifty.items).toHaveLength(30);
    const searched = await listCompanies(ctx, manager, { search: 'tests 1' });
    expect(searched.total).toBe(10);
  });

  it('ignores a sort, direction, page or size it does not know', async () => {
    await createCompany(db, { name: 'Adiutor Tests' });

    const listed = await listCompanies(ctx, manager, {
      sort: 'nonsense' as 'name',
      dir: 'sideways' as 'asc',
      page: -3,
      size: 7 as 25,
    });

    expect(listed).toMatchObject({ total: 1, page: 1, size: 25 });
  });
});

/**
 * Reads the company events in the audit log, oldest first.
 *
 * @returns Each event's action, actor, company and details.
 */
async function companyEvents() {
  return db
    .select({
      action: auditEvent.action,
      actorUserId: auditEvent.actorUserId,
      companyId: auditEvent.companyId,
      details: auditEvent.details,
    })
    .from(auditEvent)
    .where(sql`${auditEvent.action} like 'company_%'`)
    .orderBy(auditEvent.id);
}

describe('deactivation', () => {
  it('locks members out while staff keep access, and can be undone', async () => {
    const testCompany = await createCompany(db);
    const member = await memberActor(db, testCompany.id, 'admin');

    await setCompanyActive(ctx, manager, { companyId: testCompany.id, active: false });
    await expect(getCompanyAccess(db, member, testCompany.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(
      (await getCompanyAccess(db, manager, testCompany.id)).company.deactivatedAt,
    ).not.toBeNull();

    await setCompanyActive(ctx, manager, { companyId: testCompany.id, active: true });
    expect(
      (await getCompanyAccess(db, member, testCompany.id)).permissions.has('members:manage'),
    ).toBe(true);

    // Both changes are in the audit log.
    expect(await companyEvents()).toEqual(
      ['company_deactivated', 'company_reactivated'].map((action) => ({
        action,
        actorUserId: manager.id,
        companyId: testCompany.id,
        details: { name: testCompany.name },
      })),
    );
  });

  /**
   * Reads when a company was deactivated.
   *
   * @param companyId - The company.
   * @returns The time, or `null` while it's active.
   */
  async function deactivatedAtOf(companyId: string): Promise<Date | null> {
    const row = firstRow(
      await db
        .select({ deactivatedAt: company.deactivatedAt })
        .from(company)
        .where(eq(company.id, companyId)),
      'the company',
    );
    return row.deactivatedAt;
  }

  it('refuses deactivating a deactivated company, keeping its date and recording it once', async () => {
    const testCompany = await createCompany(db);
    await setCompanyActive(ctx, manager, { companyId: testCompany.id, active: false });
    const deactivatedAt = await deactivatedAtOf(testCompany.id);

    await expect(
      setCompanyActive(ctx, manager, { companyId: testCompany.id, active: false }),
    ).rejects.toMatchObject({ code: 'conflict', key: 'errors.companies.alreadyDeactivated' });

    expect(await deactivatedAtOf(testCompany.id)).toEqual(deactivatedAt);
    expect((await companyEvents()).map(({ action }) => action)).toEqual(['company_deactivated']);
  });

  it('refuses reactivating an active company, recording nothing', async () => {
    const testCompany = await createCompany(db);

    await expect(
      setCompanyActive(ctx, manager, { companyId: testCompany.id, active: true }),
    ).rejects.toMatchObject({ code: 'conflict', key: 'errors.companies.alreadyActive' });

    expect(await companyEvents()).toEqual([]);
  });

  it('refuses a deactivation someone else made while the request waited for the company', async () => {
    const testCompany = await createCompany(db);

    const { second } = await atTheSameMoment(
      db,
      (tx) =>
        tx
          .update(company)
          .set({ deactivatedAt: sql`now()` })
          .where(eq(company.id, testCompany.id)),
      () => setCompanyActive(ctx, manager, { companyId: testCompany.id, active: false }),
    );

    expect(second).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'conflict' }),
    });
    expect(await companyEvents()).toEqual([]);
  });
});

describe('updateCompany', () => {
  it('says whether the URL name changed, so the page can follow the company to its new address', async () => {
    const testCompany = await createCompany(db);

    await expect(
      updateCompany(ctx, manager, {
        companyId: testCompany.id,
        name: 'Adiutor Tests Renamed',
        slug: testCompany.slug,
      }),
    ).resolves.toEqual({ slug: testCompany.slug, slugChanged: false });
    await expect(
      updateCompany(ctx, manager, {
        companyId: testCompany.id,
        name: 'Adiutor Tests Renamed',
        slug: 'adiutor-tests-moved',
      }),
    ).resolves.toEqual({ slug: 'adiutor-tests-moved', slugChanged: true });
    // Its new address works, and so does its ID.
    expect((await getCompanyAccess(db, manager, 'adiutor-tests-moved')).company.id).toBe(
      testCompany.id,
    );
  });

  it('refuses a URL name another company has, changing and recording nothing', async () => {
    const taken = await createCompany(db);
    const testCompany = await createCompany(db);

    await expect(
      updateCompany(ctx, manager, {
        companyId: testCompany.id,
        name: 'Adiutor Tests Renamed',
        slug: taken.slug,
      }),
    ).rejects.toMatchObject({
      code: 'conflict',
      key: 'errors.companies.slugTaken',
    });
    expect((await getCompanyAccess(db, manager, testCompany.id)).company).toMatchObject({
      name: testCompany.name,
      slug: testCompany.slug,
    });
    expect(await companyEvents()).toEqual([]);
  });

  it('renames a company', async () => {
    const testCompany = await createCompany(db);
    await updateCompany(ctx, manager, {
      companyId: testCompany.id,
      name: 'Adiutor Tests Renamed',
      slug: 'adiutor-tests-renamed',
    });
    expect((await getCompanyAccess(db, manager, testCompany.id)).company).toMatchObject({
      name: 'Adiutor Tests Renamed',
      slug: 'adiutor-tests-renamed',
    });
    expect(await companyEvents()).toEqual([
      {
        action: 'company_updated',
        actorUserId: manager.id,
        companyId: testCompany.id,
        details: {
          from: { name: testCompany.name, slug: testCompany.slug },
          to: { name: 'Adiutor Tests Renamed', slug: 'adiutor-tests-renamed' },
        },
      },
    ]);
  });
});
