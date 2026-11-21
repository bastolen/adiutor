/**
 * @file Integration tests for registering user accounts, against the test
 * database.
 */
import { eq, like } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { auditEvent, membership, staffSettings, user, verification } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';
import { hashVerificationIdentifier } from '@/lib/sign-in/tokens';

import {
  createStaffSettings,
  createUser,
  emailLanguage,
  inLanguage,
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

  it('saves the language chosen for the new user, and welcomes them in it', async () => {
    const { userId } = await registerUser(inLanguage(ctx, 'en-US'), manager, 'nl@adiutor.test', {
      locale: 'nl-NL',
    });

    const created = firstRow(
      await db.select({ locale: user.locale }).from(user).where(eq(user.id, userId)),
      'the new user',
    );
    expect(created.locale).toBe('nl-NL');
    const welcome = defined(sent[0], 'the welcome email');
    expect(emailLanguage(welcome)).toBe('nl-NL');
    expect(welcome.subject).toBe('Je Adiutor-account staat klaar');
  });

  it('refuses a language that’s turned off, and creates nobody', async () => {
    await db.update(staffSettings).set({ offeredLocales: ['en-US', 'es-ES'] });

    await expect(
      registerUser(ctx, manager, 'nl@adiutor.test', { locale: 'nl-NL' }),
    ).rejects.toMatchObject({ key: 'errors.language.notOffered' });
    expect(await db.select().from(user).where(eq(user.email, 'nl@adiutor.test'))).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('on Default, saves no language and welcomes them in Adiutor’s default, not the sender’s', async () => {
    await db.update(staffSettings).set({ defaultLocale: 'nl-NL' });
    const { userId } = await registerUser(inLanguage(ctx, 'es-ES'), manager, 'nl@adiutor.test');

    const created = firstRow(
      await db.select({ locale: user.locale }).from(user).where(eq(user.id, userId)),
      'the new user',
    );
    expect(created.locale).toBeNull();
    expect(sent.map((email) => [email.to, emailLanguage(email)])).toEqual([
      ['nl@adiutor.test', 'nl-NL'],
    ]);
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
