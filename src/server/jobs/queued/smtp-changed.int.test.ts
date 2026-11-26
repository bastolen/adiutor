/**
 * @file Integration tests for the queued "the mail server changed" email
 * (`smtp-changed`): it goes to the staff Admin it names, in their language,
 * naming who changed it, and is skipped for someone who is no longer an
 * active staff Admin.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { user } from '@/db/schema';

import {
  sendQueuedEmails,
  setupTestContext,
  staffActor,
} from '../../../../tests/integration/helpers';
import { queueJob } from '../../queue';
import smtpChangedJob from './smtp-changed';

const { ctx, db, sent } = setupTestContext();

describe('the smtp-changed job', () => {
  it('tells the staff Admin who changed the mail server, and to what', async () => {
    const jane = await staffActor(db, 'platform_admin', 'jane@adiutor.test');
    const sam = await staffActor(db, 'platform_admin', 'sam@adiutor.test');
    await queueJob(db, smtpChangedJob, {
      recipientId: sam.id,
      byUserId: jane.id,
      server: 'smtp.adiutor.test:587',
    });

    await sendQueuedEmails(ctx, [smtpChangedJob]);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('sam@adiutor.test');
    expect(sent[0]?.text).toContain(
      `${jane.name} changed the mail server Adiutor sends email through to smtp.adiutor.test:587.`,
    );
  });

  it('says so without a name when the account of whoever changed it is gone', async () => {
    const jane = await staffActor(db, 'platform_admin', 'jane@adiutor.test');
    const sam = await staffActor(db, 'platform_admin', 'sam@adiutor.test');
    await queueJob(db, smtpChangedJob, {
      recipientId: sam.id,
      byUserId: jane.id,
      server: 'smtp.adiutor.test:587',
    });
    await db.execute(sql`delete from "user" where id = ${jane.id}`);

    await sendQueuedEmails(ctx, [smtpChangedJob]);

    expect(sent[0]?.text).toContain(
      'The mail server Adiutor sends email through was changed to smtp.adiutor.test:587.',
    );
  });

  it('is skipped for someone who is no longer a staff Admin', async () => {
    const jane = await staffActor(db, 'platform_admin', 'jane@adiutor.test');
    const sam = await staffActor(db, 'platform_admin', 'sam@adiutor.test');
    await queueJob(db, smtpChangedJob, {
      recipientId: sam.id,
      byUserId: jane.id,
      server: 'smtp.adiutor.test:587',
    });
    await db.update(user).set({ platformRole: 'support' }).where(eq(user.id, sam.id));

    const runs = await sendQueuedEmails(ctx, [smtpChangedJob]);

    expect(sent).toEqual([]);
    expect(runs).toEqual([
      expect.objectContaining({ summary: expect.objectContaining({ skipped: 1 }) }),
    ]);
  });
});
