/**
 * @file Integration tests for inviting people by email: privacy, many addresses
 * at once, and who may invite.
 */
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { company, invitation, user } from '@/db/schema';
import { defined } from '@/lib/defined';

import { listPendingInvitations } from './manage';
import { type BulkInviteResult, inviteByEmail, inviteManyByEmail } from './send';
import { db, ctx, sent } from './test-helpers';
import {
  createCompany,
  createStaffSettings,
  createUser,
  inSequence,
  memberActor,
  staffActor,
} from '../../../../tests/integration/helpers';
import type { Actor } from '../../actor';

/** Shared fixtures, recreated before each test. */
let testCompany: Awaited<ReturnType<typeof createCompany>>;
let companyAdmin: Actor;
let staffManager: Actor;

beforeEach(async () => {
  await createStaffSettings(db);
  testCompany = await createCompany(db);
  companyAdmin = await memberActor(db, testCompany.id, 'admin');
  staffManager = await staffActor(db, 'manager');
  await memberActor(db, testCompany.id, 'client', 'member@adiutor.test');
  await createUser(db, 'existing@adiutor.test');
});

describe('inviteByEmail privacy', () => {
  it('gives a company admin the same result for new, existing and member emails', async () => {
    const results = await Promise.all(
      ['new@adiutor.test', 'existing@adiutor.test', 'member@adiutor.test'].map((email) =>
        inviteByEmail(ctx, companyAdmin, { companyId: testCompany.id, email, role: 'client' }),
      ),
    );
    expect(results).toEqual([{ status: 'sent' }, { status: 'sent' }, { status: 'sent' }]);

    // Everyone gets the email that's true for them.
    const byRecipient = Object.fromEntries(sent.map((email) => [email.to, email.subject]));
    expect(byRecipient['new@adiutor.test']).toMatch(/invited you to join Adiutor Tests/);
    expect(byRecipient['existing@adiutor.test']).toMatch(/invited you to join Adiutor Tests/);
    expect(byRecipient['member@adiutor.test']).toMatch(/already a member of Adiutor Tests/);

    // No invitation is created for someone who's already a member.
    const open = (await listPendingInvitations(ctx, companyAdmin, testCompany.id)).items;
    expect(open.map((row) => row.email).sort()).toEqual([
      'existing@adiutor.test',
      'new@adiutor.test',
    ]);
  });

  it('shows staff the real status', async () => {
    const results = await inSequence(
      ['new@adiutor.test', 'existing@adiutor.test', 'member@adiutor.test'],
      (email) =>
        inviteByEmail(ctx, staffManager, { companyId: testCompany.id, email, role: 'watcher' }),
    );
    expect(results.map((result) => result.status)).toEqual([
      'sent',
      'sent_existing_user',
      'already_member',
    ]);
  });

  it('normalizes the email address', async () => {
    await inviteByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      email: '  New@Adiutor.TEST ',
      role: 'client',
    });
    expect(defined(sent[0], 'the invitation email').to).toBe('new@adiutor.test');
  });
});

describe('inviteManyByEmail', () => {
  it('invites each address once, keeping the privacy rule per address', async () => {
    const results = await inviteManyByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      emails: 'new@adiutor.test\nexisting@adiutor.test, member@adiutor.test, New@adiutor.test',
      role: 'client',
    });

    expect(results).toEqual([
      { email: 'new@adiutor.test', ok: true, status: 'sent' },
      { email: 'existing@adiutor.test', ok: true, status: 'sent' },
      { email: 'member@adiutor.test', ok: true, status: 'sent' },
    ]);
    expect(sent).toHaveLength(3);
  });

  it('refuses invalid entries and too many addresses before sending anything', async () => {
    await expect(
      inviteManyByEmail(ctx, companyAdmin, {
        companyId: testCompany.id,
        emails: 'new@adiutor.test, nope',
        role: 'client',
      }),
    ).rejects.toMatchObject({
      code: 'invalid',
      message: 'This isn’t a valid email address: nope.',
    });
    await expect(
      inviteManyByEmail(ctx, companyAdmin, {
        companyId: testCompany.id,
        emails: 'nope, nada',
        role: 'client',
      }),
    ).rejects.toMatchObject({
      code: 'invalid',
      message: 'These aren’t valid email addresses: nope, nada.',
    });
    const many = Array.from({ length: 21 }, (_, index) => `user${index}@adiutor.test`).join(',');
    await expect(
      inviteManyByEmail(ctx, companyAdmin, {
        companyId: testCompany.id,
        emails: many,
        role: 'client',
      }),
    ).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('up to 20') });
    expect(sent).toEqual([]);
  });

  it('hides another company from its users once, before the first address', async () => {
    const other = await createCompany(db);
    const outsider = await memberActor(db, other.id, 'admin');
    await expect(
      inviteManyByEmail(ctx, outsider, {
        companyId: testCompany.id,
        emails: 'new@adiutor.test, existing@adiutor.test',
        role: 'client',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(sent).toEqual([]);
    expect(await db.$count(invitation)).toBe(0);
  });

  it.each([
    { role: 'support', target: 'a company', staff: false },
    { role: 'finance', target: 'a company', staff: false },
    { role: 'manager', target: 'the staff', staff: true },
  ] as const)(
    'refuses $role inviting to $target once, before the first address',
    async ({ role, staff }) => {
      const viewer = await staffActor(db, role);
      await expect(
        inviteManyByEmail(ctx, viewer, {
          companyId: staff ? null : testCompany.id,
          emails: 'new@adiutor.test, existing@adiutor.test',
          role: staff ? 'support' : 'client',
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      expect(sent).toEqual([]);
      expect(await db.$count(invitation)).toBe(0);
    },
  );

  it('reports a deadlock for its address and goes on with the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const second = 'second@adiutor.test';
    const { promise: held, resolve: holding } = Promise.withResolvers<number>();
    const { promise: bulkWaits, resolve: bulkWaiting } = Promise.withResolvers<void>();
    // Holds the second address's per-address lock. Once the bulk invite's transaction for it waits
    // there, holding the actor's row (`assertStillManages`), this asks for that row: a deadlock.
    // The bulk invite waited first, so Postgres ends its transaction.
    const holder = db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`invitation:${testCompany.id}:${second}`}, 0))`,
      );
      const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      holding(defined(rows[0], 'the backend row').pid);
      await bulkWaits;
      await tx.select({ id: user.id }).from(user).where(eq(user.id, companyAdmin.id)).for('update');
    });
    let bulk: Promise<PromiseSettledResult<BulkInviteResult[]>[]> = Promise.resolve([]);
    try {
      const pid = await held;
      bulk = Promise.allSettled([
        inviteManyByEmail(ctx, companyAdmin, {
          companyId: testCompany.id,
          emails: `first@adiutor.test, ${second}, third@adiutor.test`,
          role: 'client',
        }),
      ]);
      await vi.waitFor(
        async () => {
          const { rows } = await db.execute<{ waiting: number }>(
            sql`select count(*)::int as waiting from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`,
          );
          expect(defined(rows[0], 'the waiting count').waiting).toBe(1);
        },
        { timeout: 5_000 },
      );
    } finally {
      bulkWaiting();
      await holder;
    }

    expect(await bulk).toEqual([
      {
        status: 'fulfilled',
        value: [
          { email: 'first@adiutor.test', ok: true, status: 'sent' },
          {
            email: second,
            ok: false,
            message: 'Someone changed this at the same moment. Try again.',
          },
          { email: 'third@adiutor.test', ok: true, status: 'sent' },
        ],
      },
    ]);
    // Nothing was sent to the address whose transaction ended.
    const invited = await db.select({ email: invitation.email }).from(invitation);
    expect(invited.map(({ email }) => email).sort()).toEqual([
      'first@adiutor.test',
      'third@adiutor.test',
    ]);
    expect(sent.map(({ to }) => to)).toEqual(['first@adiutor.test', 'third@adiutor.test']);
    expect(warn).toHaveBeenCalledWith(
      'A bulk invitation hit a database deadlock; that address was reported as a conflict.',
    );
    warn.mockRestore();
  });
});

describe('inviteByEmail permissions', () => {
  it('hides companies from outsiders', async () => {
    const other = await createCompany(db);
    const outsider = await memberActor(db, other.id, 'admin');
    await expect(
      inviteByEmail(ctx, outsider, {
        companyId: testCompany.id,
        email: 'x@adiutor.test',
        role: 'client',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses roles from the other kind of company', async () => {
    await expect(
      inviteByEmail(ctx, companyAdmin, {
        companyId: testCompany.id,
        email: 'x@adiutor.test',
        role: 'manager',
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('refuses invitations to a deactivated company', async () => {
    await db
      .update(company)
      .set({ deactivatedAt: new Date() })
      .where(eq(company.id, testCompany.id));
    await expect(
      inviteByEmail(ctx, staffManager, {
        companyId: testCompany.id,
        email: 'x@adiutor.test',
        role: 'client',
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
});
