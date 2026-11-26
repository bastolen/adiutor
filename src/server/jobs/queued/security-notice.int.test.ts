/**
 * @file Integration tests for the queued security notice, against the test
 * database: queuing keeps only IDs and small settings; sending reads the
 * names and, for the user's own change, the device, IP address and time
 * from its audit event; a user who's gone is skipped; and a mail problem
 * leaves the notice to be tried again.
 */
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { company, queuedJob, user } from '@/db/schema';

import {
  createCompany,
  createUser,
  mailDown,
  sendQueuedEmails,
  setupTestContext,
  setUserLocale,
  staffActor,
} from '../../../../tests/integration/helpers';
import { recordEvent } from '../../audit';
import { queueSecurityNotice } from '../../auth/security-notices';
import type { ServiceContext } from '../../context';
import securityNoticeJob from './security-notice';

const { ctx, db, sent } = setupTestContext();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('queueSecurityNotice', () => {
  it('queues the notice with IDs and small settings only', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const { id: companyId } = await createCompany(db, { name: 'Adiutor Tests Client' });

    await expect(
      queueSecurityNotice(db, jane, 'company_role_changed', { role: 'client', companyId }),
    ).resolves.toBe(true);

    const [job] = await db.select().from(queuedJob);
    expect(job).toMatchObject({
      kind: 'security-notice',
      payload: {
        userId: jane,
        kind: 'company_role_changed',
        auditEventId: null,
        providerId: null,
        role: 'client',
        companyId,
        staffUserId: null,
      },
    });
    expect(JSON.stringify(job?.payload)).not.toContain('adiutor.test');
    // Nothing goes out until the tick.
    expect(sent).toEqual([]);
  });
});

describe('the security-notice job', () => {
  it('names the device, IP address and time of the user’s own change, from its audit event', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const fromFirefox: ServiceContext = {
      ...ctx,
      /**
       * Pretends the request came from Firefox on Windows at a known IP address.
       *
       * @returns The request's origin.
       */
      requestInfo: async () => ({
        ip: '203.0.113.7',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
      }),
    };
    const auditEventId = await recordEvent(fromFirefox, {
      action: 'password_changed',
      actorUserId: jane,
      targetUserId: jane,
    });
    await queueSecurityNotice(db, jane, 'password_changed', { auditEventId });

    await sendQueuedEmails(ctx, [securityNoticeJob]);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'jane@adiutor.test',
      subject: 'Your password for Adiutor was changed',
    });
    expect(sent[0]?.text).toContain('Firefox on Windows, 203.0.113.7');
  });

  it('never names the device of an event that isn’t the recipient’s own', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sam = await staffActor(db, 'platform_admin', 'sam@adiutor.test');
    const fromFirefox: ServiceContext = {
      ...ctx,
      /**
       * Pretends the request came from Firefox on Windows at a known IP address.
       *
       * @returns The request's origin.
       */
      requestInfo: async () => ({
        ip: '203.0.113.9',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
      }),
    };
    // A staff member's change to Jane's account, queued by mistake with its event.
    const auditEventId = await recordEvent(fromFirefox, {
      action: 'mfa_reset',
      actorUserId: sam.id,
      targetUserId: jane,
    });
    await queueSecurityNotice(db, jane, 'mfa_reset', { auditEventId });

    await sendQueuedEmails(ctx, [securityNoticeJob]);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).not.toContain('203.0.113.9');
    expect(sent[0]?.text).not.toContain('Firefox');
  });

  it('names no device for someone else’s change, and reads names when it sends', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await setUserLocale(db, jane, 'nl-NL');
    const { id: companyId } = await createCompany(db, { name: 'Adiutor Tests Client' });
    await queueSecurityNotice(db, jane, 'company_role_changed', { role: 'client', companyId });
    // Renamed before the tick: the email names the company as it's called now.
    await db
      .update(company)
      .set({ name: 'Adiutor Tests Renamed' })
      .where(eq(company.id, companyId));

    await sendQueuedEmails(ctx, [securityNoticeJob]);

    expect(sent[0]?.subject).toBe('Je rol bij Adiutor Tests Renamed op Adiutor is gewijzigd');
    expect(sent[0]?.text).not.toContain('Vanaf:');
  });

  it('names the staff member who signed in as the user', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sam = await staffActor(db, 'platform_admin', 'sam@adiutor.test');
    await queueSecurityNotice(db, jane, 'impersonation_started', { staffUserId: sam.id });

    await sendQueuedEmails(ctx, [securityNoticeJob]);

    expect(sent[0]?.subject).toContain('sam');
  });

  it('gives the time in the recipient’s zone, naming it', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ timeZone: 'Asia/Kolkata' }).where(eq(user.id, jane));
    await queueSecurityNotice(db, jane, 'mfa_reset');

    await sendQueuedEmails(ctx, [securityNoticeJob]);

    expect(sent[0]?.text).toMatch(/When: .+ GMT\+5:30/);
  });

  it('names the provider of a connected account', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await queueSecurityNotice(db, jane, 'provider_connected', { providerId: 'github' });

    await sendQueuedEmails(ctx, [securityNoticeJob]);

    expect(sent[0]?.subject).toBe('GitHub was connected to your account on Adiutor');
  });

  it('skips a notice whose user is gone', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await queueSecurityNotice(db, jane, 'mfa_reset');
    await db.execute(sql`delete from "user" where id = ${jane}`);

    const runs = await sendQueuedEmails(ctx, [securityNoticeJob]);

    expect(sent).toEqual([]);
    expect(runs).toEqual([
      expect.objectContaining({ summary: expect.objectContaining({ skipped: 1 }) }),
    ]);
  });

  it('is tried again when the mail server refuses it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const jane = await createUser(db, 'jane@adiutor.test');
    await queueSecurityNotice(db, jane, 'mfa_reset');
    await sendQueuedEmails(mailDown(ctx), [securityNoticeJob]);

    expect(
      await db.select({ status: queuedJob.status, attempts: queuedJob.attempts }).from(queuedJob),
    ).toEqual([{ status: 'queued', attempts: 1 }]);
  });
});
