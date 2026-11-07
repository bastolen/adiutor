/**
 * @file Integration tests for registering user accounts, against the test
 * database.
 */
import { eq, like } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { auditEvent, membership, user, verification } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';
import { hashVerificationIdentifier } from '@/lib/sign-in/tokens';

import {
  createStaffSettings,
  createUser,
  setupTestContext,
  staffActor,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { registerUser } from './user-registration';

const { ctx, db, sent } = setupTestContext();

/** Shared fixtures, recreated before each test. */
let manager: Actor;

beforeEach(async () => {
  await createStaffSettings(db, 'Adiutor Tests');
  manager = await staffActor(db, 'manager', 'manager@adiutor.test');
});

describe('registerUser', () => {
  it('creates an account without companies or staff access and emails a password link', async () => {
    const result = await registerUser(ctx, manager, ' New.Person@Adiutor.test ');
    expect(result.status).toBe('created');

    const [created] = await db.select().from(user).where(eq(user.id, result.userId));
    expect(created).toMatchObject({
      email: 'new.person@adiutor.test',
      name: '',
      emailVerified: false,
      platformRole: null,
    });
    expect(await db.select().from(membership).where(eq(membership.userId, result.userId))).toEqual(
      [],
    );

    // The link is a Better Auth password reset token for the new user, valid for 7 days, stored
    // hashed the way Better Auth stores its own.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'new.person@adiutor.test',
      subject: 'Your Adiutor account is ready',
    });
    const linkToken = /reset-password\?token=([\w-]+)&welcome=1/.exec(
      defined(sent[0], 'the password link email').text,
    )?.[1];
    expect(linkToken).toBeDefined();
    const token = firstRow(
      await db
        .select()
        .from(verification)
        .where(
          eq(verification.identifier, hashVerificationIdentifier(`reset-password:${linkToken}`)),
        ),
      'the password reset token',
    );
    expect(token.value).toBe(result.userId);
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect(
      await db.select().from(verification).where(like(verification.identifier, 'reset-password:%')),
    ).toEqual([]);

    const [entry] = await db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.action, 'account_created'));
    expect(entry).toMatchObject({ actorUserId: manager.id, targetUserId: result.userId });
  });

  it('reports an existing account without changing anything', async () => {
    const existing = await createUser(db, 'existing@adiutor.test');
    expect(await registerUser(ctx, manager, 'existing@adiutor.test')).toEqual({
      status: 'exists',
      userId: existing,
    });
    expect(sent).toEqual([]);
  });
});
