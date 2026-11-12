/**
 * @file Integration tests for answering the tick's endpoint, against the
 * test database: off without a secret, refusing a wrong one (and, past the
 * limit, answering 429 while the right secret still works), running the tick
 * with the right one, and reporting a failed run with 500.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { invitation, jobRun } from '@/db/schema';

import { createCompany, memberActor, setupTestContext } from '../../../tests/integration/helpers';
import type { ServiceContext } from '../context';
import { inviteByEmail } from '../people/invitations';
import { RATE_LIMITS } from '../rate-limit';
import { answerTickRequest } from './endpoint';

const { ctx, db } = setupTestContext();

/** The configured secret, as long as a real one. */
const SECRET = 'adiutor-tests-cron-secret-0123456789abcdef';

/** The service context of a request from one address. */
const fromAddress: ServiceContext = {
  ...ctx,
  /**
   * Where the request came from.
   *
   * @returns A fixed IP address.
   */
  requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'adiutor-tests-cron' }),
};

/**
 * Asks the endpoint with an `Authorization` header.
 *
 * @param authorization - The header, or `null` for none.
 * @param context - The service context; the one of a request from one address by default.
 * @returns The answer.
 */
async function ask(authorization: string | null, context: ServiceContext = fromAddress) {
  return answerTickRequest(context, { authorization, secret: SECRET });
}

describe('answerTickRequest', () => {
  it('is off while no secret is configured', async () => {
    await expect(
      answerTickRequest(fromAddress, { authorization: `Bearer ${SECRET}`, secret: undefined }),
    ).resolves.toEqual({ status: 503, body: { status: 'disabled' } });
    expect(await db.select().from(jobRun)).toEqual([]);
  });

  it('refuses a missing or wrong secret, without running anything', async () => {
    await expect(ask(null)).resolves.toEqual({ status: 401, body: { status: 'unauthorized' } });
    await expect(ask(`Bearer ${SECRET}x`)).resolves.toMatchObject({ status: 401 });
    await expect(ask(SECRET)).resolves.toMatchObject({ status: 401 });

    expect(await db.select().from(jobRun)).toEqual([]);
  });

  it('answers 429 after too many wrong secrets, while the right one still runs the tick', async () => {
    await Promise.all(
      Array.from({ length: RATE_LIMITS.jobTickMissesPerIp.limit }, () => ask('Bearer wrong')),
    );

    await expect(ask('Bearer wrong')).resolves.toEqual({
      status: 429,
      body: { status: 'too_many_requests' },
    });
    await expect(ask(`Bearer ${SECRET}`)).resolves.toMatchObject({ status: 200 });
  });

  it('runs every due job with the right secret, and says what each did', async () => {
    const answer = await ask(`Bearer ${SECRET}`);

    expect(answer).toMatchObject({ status: 200, body: { status: 'ok', leftForNextTick: [] } });
    expect('runs' in answer.body && answer.body.runs).toContainEqual({
      job: 'expired-sign-in-data',
      status: 'succeeded',
      summary: { verifications: 0, sessions: 0, rateLimits: 0 },
    });
    expect(
      await db.select({ trigger: jobRun.trigger }).from(jobRun).where(eq(jobRun.job, 'retention')),
    ).toEqual([{ trigger: 'tick' }]);
  });

  it('answers 500 when a run failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const company = await createCompany(db, { name: 'Adiutor Tests Client' });
    const admin = await memberActor(db, company.id, 'admin', 'boss@adiutor.test');
    await inviteByEmail(ctx, admin, {
      companyId: company.id,
      email: 'soon@adiutor.test',
      role: 'client',
    });
    // Due for a reminder, which the mail server refuses.
    await db
      .update(invitation)
      .set({ createdAt: sql`now() - interval '5 days'`, expiresAt: sql`now() + interval '1 day'` })
      .where(eq(invitation.email, 'soon@adiutor.test'));
    const mailDown: ServiceContext = {
      ...fromAddress,
      /** The mail server is down. */
      sendEmail: async () => {
        throw new Error('Adiutor Tests: the mail server is down');
      },
    };

    const answer = await ask(`Bearer ${SECRET}`, mailDown);

    expect(answer).toMatchObject({ status: 500, body: { status: 'failed' } });
    expect('runs' in answer.body && answer.body.runs).toContainEqual({
      job: 'invitation-reminders',
      status: 'failed',
      summary: { sent: 0, failed: 1 },
    });
  });
});
