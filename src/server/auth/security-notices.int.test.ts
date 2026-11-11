/**
 * @file Integration tests for security notices: the device and IP address
 * are left out unless the caller asks for them (only for the recipient's own
 * changes), recipients by ID are looked up, each notice is in the
 * recipient's language, and sending never throws.
 */
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import {
  createStaffSettings,
  createUser,
  emailLanguage,
  inLanguage,
  setUserLocale,
  setupTestContext,
} from '../../../tests/integration/helpers';
import { sendSecurityNotice } from './security-notices';

const { ctx, db, sent } = setupTestContext();

/** A request from a known browser and IP address. */
const fromBrowser = {
  ...ctx,
  /**
   * Pretends the request came from Firefox on Windows at a known IP address.
   *
   * @returns The request info.
   */
  requestInfo: async () => ({
    ip: '203.0.113.9',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  }),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendSecurityNotice', () => {
  it('leaves out the device and IP address by default, even when the request has them', async () => {
    expect(await sendSecurityNotice(fromBrowser, { email: 'jane@adiutor.test' }, 'mfa_reset')).toBe(
      true,
    );

    expect(sent).toHaveLength(1);
    const notice = defined(sent[0], 'the notice');
    expect(notice.text).not.toContain('From:');
    expect(notice.text).not.toContain('203.0.113.9');
    expect(notice.text).not.toContain('Firefox');
  });

  it('names the device and IP address when asked to, for the recipient’s own change', async () => {
    await sendSecurityNotice(fromBrowser, { email: 'jane@adiutor.test' }, 'password_changed', {
      showDevice: true,
    });

    const notice = defined(sent[0], 'the notice');
    expect(notice.text).toContain('Firefox on Windows');
    expect(notice.text).toContain('203.0.113.9');
  });

  it('looks up a recipient by ID, and sends nothing for an unknown one', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');

    expect(await sendSecurityNotice(ctx, { userId: jane }, 'passkey_added')).toBe(true);
    expect(await sendSecurityNotice(ctx, { userId: randomUUID() }, 'passkey_added')).toBe(false);
    expect(sent.map(({ to }) => to)).toEqual(['jane@adiutor.test']);
  });

  it('writes in the language the recipient saved, found by ID or by address', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await setUserLocale(db, jane, 'nl-NL');

    // The request's language doesn't win over the one Jane saved.
    await sendSecurityNotice(inLanguage(ctx, 'es-ES'), { userId: jane }, 'passkey_added');
    await sendSecurityNotice(ctx, { email: 'jane@adiutor.test' }, 'mfa_reset');

    expect(sent.map(emailLanguage)).toEqual(['nl-NL', 'nl-NL']);
    expect(defined(sent[0], 'the notice').subject).toBe(
      'Er is een passkey toegevoegd aan je Adiutor-account',
    );
  });

  it('uses Adiutor’s default language for someone on Default, not the request’s, and names the device in it', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES');
    await createUser(db, 'jane@adiutor.test');

    await sendSecurityNotice(
      inLanguage(fromBrowser, 'nl-NL'),
      { email: 'jane@adiutor.test' },
      'password_changed',
      { showDevice: true },
    );

    expect(sent.map(emailLanguage)).toEqual(['es-ES']);
    expect(defined(sent[0], 'the Spanish notice').text).toContain(
      'Desde: Firefox en Windows, 203.0.113.9',
    );
  });

  it('falls back to English (US) before setup', async () => {
    await createUser(db, 'jane@adiutor.test');

    await sendSecurityNotice(ctx, { email: 'jane@adiutor.test' }, 'password_changed');

    expect(sent.map(emailLanguage)).toEqual(['en-US']);
  });

  it('takes the language of a deleted account from the caller', async () => {
    await sendSecurityNotice(
      inLanguage(ctx, 'en-US'),
      { email: 'gone@adiutor.test' },
      'account_deleted',
      {
        locale: 'es-ES',
      },
    );

    expect(sent.map(emailLanguage)).toEqual(['es-ES']);
    expect(defined(sent[0], 'the notice').subject).toBe('Se ha eliminado tu cuenta de Adiutor');
  });

  it('names a role in the recipient’s language', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await setUserLocale(db, jane, 'nl-NL');

    await sendSecurityNotice(ctx, { userId: jane }, 'staff_role_changed', { role: 'finance' });

    expect(defined(sent[0], 'the notice').text).toContain(
      'Een beheerder heeft je medewerkersrol op Adiutor gewijzigd in Financiën.',
    );
  });

  it('never throws: a failed send is logged by its codes only and returns false', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = {
      ...ctx,
      /** Fails like an unreachable mail server. */
      sendEmail: async () => {
        throw Object.assign(new Error('SMTP down for jane@adiutor.test'), {
          code: 'ECONNECTION',
        });
      },
    };

    expect(await sendSecurityNotice(failing, { email: 'jane@adiutor.test' }, 'mfa_reset')).toBe(
      false,
    );
    expect(logged).toHaveBeenCalledWith('Sending the "mfa_reset" security notice failed', {
      code: 'ECONNECTION',
      responseCode: null,
    });
  });
});
