/**
 * @file Integration tests for answering the tick's endpoint, against the
 * test database: off without a secret, refusing a wrong one (and, past the
 * limit, answering 429 while the right secret still works), running the tick
 * with the right one, reporting a failed run with 500, and continuing straight
 * away while work is left: a continued call answers 202 and runs its tick
 * after answering, up to the limit, on the app's own address with the secret.
 */
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { invitation, jobRun, queuedJob } from '@/db/schema';

import { createCompany, memberActor, setupTestContext } from '../../../tests/integration/helpers';
import type { ServiceContext } from '../context';
import { inviteByEmail } from '../people/invitations';
import { RATE_LIMITS } from '../rate-limit';
import {
  answerTickRequest,
  continueAfterAnswer,
  MAX_TICK_CONTINUATIONS,
  nextContinuation,
  requestTickContinuation,
  TICK_CONTINUATION_HEADER,
} from './endpoint';
import type { JobRunResult } from './run';

const { ctx, db } = setupTestContext();

afterEach(() => {
  vi.restoreAllMocks();
});

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
 * @param continuation - The continuation header, or `null` for a call from a cron service.
 * @returns The answer.
 */
async function ask(
  authorization: string | null,
  context: ServiceContext = fromAddress,
  continuation: string | null = null,
) {
  return answerTickRequest(context, { authorization, secret: SECRET, continuation });
}

/**
 * Queues security notices for users who don't exist, which the tick skips
 * quickly: enough work that a short tick can't finish it.
 *
 * @param count - How many.
 */
async function queueSkippedNotices(count: number): Promise<void> {
  await db.insert(queuedJob).values(
    Array.from({ length: count }, () => ({
      kind: 'security-notice',
      payload: {
        userId: randomUUID(),
        kind: 'mfa_reset',
        auditEventId: null,
        providerId: null,
        role: null,
        companyId: null,
        staffUserId: null,
      },
    })),
  );
}

/**
 * A fake `fetch` that notes each request and answers with a status.
 *
 * @param status - The status to answer with.
 * @returns The fake, and the requests it got.
 */
function fakeFetch(status = 202) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  /**
   * Notes the request and answers.
   *
   * @param url - Where it went.
   * @param init - Its options.
   * @returns The answer.
   */
  const send = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    return new Response(null, { status });
  };
  return { send, requests };
}

describe('answerTickRequest', () => {
  it('is off while no secret is configured', async () => {
    await expect(
      answerTickRequest(fromAddress, { authorization: `Bearer ${SECRET}`, secret: undefined }),
    ).resolves.toEqual({
      response: { status: 503, body: { status: 'disabled' } },
      afterAnswer: null,
    });
    expect(await db.select().from(jobRun)).toEqual([]);
  });

  it('refuses a missing or wrong secret, without running anything', async () => {
    await expect(ask(null)).resolves.toEqual({
      response: { status: 401, body: { status: 'unauthorized' } },
      afterAnswer: null,
    });
    await expect(ask(`Bearer ${SECRET}x`)).resolves.toMatchObject({ response: { status: 401 } });
    await expect(ask(SECRET)).resolves.toMatchObject({ response: { status: 401 } });
    // A continuation needs the secret just the same.
    await expect(ask('Bearer wrong', fromAddress, '1')).resolves.toMatchObject({
      response: { status: 401 },
      afterAnswer: null,
    });

    expect(await db.select().from(jobRun)).toEqual([]);
  });

  it('answers 429 after too many wrong secrets, while the right one still runs the tick', async () => {
    await Promise.all(
      Array.from({ length: RATE_LIMITS.jobTickMissesPerIp.limit }, () => ask('Bearer wrong')),
    );

    await expect(ask('Bearer wrong')).resolves.toMatchObject({
      response: { status: 429, body: { status: 'too_many_requests' } },
    });
    await expect(ask(`Bearer ${SECRET}`)).resolves.toMatchObject({ response: { status: 200 } });
  });

  it('runs every due job with the right secret, and says what each did', async () => {
    const { response, afterAnswer } = await ask(`Bearer ${SECRET}`);

    expect(response).toMatchObject({
      status: 200,
      body: { status: 'ok', leftForNextTick: [], continues: false },
    });
    expect(afterAnswer).toBeNull();
    expect('runs' in response.body && response.body.runs).toContainEqual({
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

    const { response } = await ask(`Bearer ${SECRET}`, mailDown);

    expect(response).toMatchObject({ status: 500, body: { status: 'failed' } });
    expect('runs' in response.body && response.body.runs).toContainEqual({
      job: 'invitation-reminders',
      status: 'failed',
      summary: { sent: 0, failed: 1 },
    });
  });
});

describe('continuing the tick', () => {
  it('refuses a malformed continuation once the secret is right', async () => {
    await Promise.all(
      ['abc', '0', String(MAX_TICK_CONTINUATIONS + 1), '1.5', ''].map(async (header) => {
        await expect(ask(`Bearer ${SECRET}`, fromAddress, header)).resolves.toEqual({
          response: { status: 400, body: { status: 'invalid' } },
          afterAnswer: null,
        });
      }),
    );
    expect(await db.select().from(jobRun)).toEqual([]);
  });

  it('continues a tick that stopped at its deadline with work left', async () => {
    await queueSkippedNotices(300);

    const { response, afterAnswer } = await answerTickRequest(fromAddress, {
      authorization: `Bearer ${SECRET}`,
      secret: SECRET,
      tickSeconds: 0.05,
    });

    expect(response).toMatchObject({ status: 200, body: { continues: true } });
    await expect(afterAnswer?.()).resolves.toBe(1);
  });

  it('stops a tick that got nothing done, however much is due', async () => {
    await queueSkippedNotices(5);

    const { response, afterAnswer } = await answerTickRequest(fromAddress, {
      authorization: `Bearer ${SECRET}`,
      secret: SECRET,
      tickSeconds: 0,
    });

    expect(response).toMatchObject({ status: 200, body: { runs: [], continues: false } });
    expect(afterAnswer).toBeNull();
  });

  it('answers a continued call at once, and runs its tick after answering', async () => {
    const { response, afterAnswer } = await ask(`Bearer ${SECRET}`, fromAddress, '3');

    expect(response).toEqual({ status: 202, body: { status: 'continuing', step: 3 } });
    // Nothing ran before the answer.
    expect(await db.select().from(jobRun)).toEqual([]);
    // Nothing is left once it ran, so it doesn't continue again.
    await expect(afterAnswer?.()).resolves.toBeNull();
    expect(await db.select().from(jobRun)).not.toEqual([]);
  });

  it('continues only while work is due, the tick did something and the limit allows', () => {
    const ran = [{ job: 'retention' } as JobRunResult];
    expect(nextContinuation({ moreDue: true, runs: ran }, 0)).toBe(1);
    expect(nextContinuation({ moreDue: true, runs: ran }, MAX_TICK_CONTINUATIONS - 1)).toBe(
      MAX_TICK_CONTINUATIONS,
    );
    expect(nextContinuation({ moreDue: true, runs: ran }, MAX_TICK_CONTINUATIONS)).toBeNull();
    expect(nextContinuation({ moreDue: false, runs: ran }, 0)).toBeNull();
    expect(nextContinuation({ moreDue: true, runs: [] }, 0)).toBeNull();
  });

  it('calls the app’s own address with the secret, the step and, when set, the bypass', async () => {
    const plain = fakeFetch();
    const bypassed = fakeFetch();

    await expect(
      requestTickContinuation(ctx, 2, { secret: SECRET, fetch: plain.send }),
    ).resolves.toBe(true);
    await requestTickContinuation(ctx, 2, {
      secret: SECRET,
      bypassSecret: 'adiutor-tests-bypass',
      fetch: bypassed.send,
    });

    expect(plain.requests).toEqual([
      {
        url: `${ctx.baseUrl}/api/jobs`,
        headers: { authorization: `Bearer ${SECRET}`, [TICK_CONTINUATION_HEADER]: '2' },
      },
    ]);
    expect(bypassed.requests[0]?.headers).toMatchObject({
      'x-vercel-protection-bypass': 'adiutor-tests-bypass',
    });
  });

  it('logs a continuation that isn’t accepted, without the secret, and never throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refused = fakeFetch(401);
    /**
     * Fails like an unreachable address.
     *
     * @returns Never; it rejects.
     */
    const unreachable = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;

    await expect(
      requestTickContinuation(ctx, 4, { secret: SECRET, fetch: refused.send }),
    ).resolves.toBe(false);
    await expect(
      requestTickContinuation(ctx, 4, { secret: SECRET, fetch: unreachable }),
    ).resolves.toBe(false);

    expect(logged).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(SECRET);
  });

  it('after answering, asks for the next continuation only when there is one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const once = fakeFetch();
    const never = fakeFetch();
    const broken = fakeFetch();

    await continueAfterAnswer(ctx, async () => 5, { secret: SECRET, fetch: once.send });
    await continueAfterAnswer(ctx, async () => null, { secret: SECRET, fetch: never.send });
    await expect(
      continueAfterAnswer(
        ctx,
        async () => {
          throw new Error('Adiutor Tests: the database is unreachable');
        },
        { secret: SECRET, fetch: broken.send },
      ),
    ).resolves.toBeUndefined();

    expect(once.requests.map((request) => request.headers[TICK_CONTINUATION_HEADER])).toEqual([
      '5',
    ]);
    expect(never.requests).toEqual([]);
    expect(broken.requests).toEqual([]);
  });
});
