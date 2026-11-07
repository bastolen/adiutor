/**
 * @file Integration tests for security notices: the device and IP address
 * are left out unless the caller asks for them (only for the recipient's own
 * changes), recipients by ID are looked up, and sending never throws.
 */
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import { sendSecurityNotice } from './security-notices';
import { createUser, setupTestContext } from '../../../tests/integration/helpers';

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

  it('never throws: a failed send is logged and returns false', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = {
      ...ctx,
      /** Fails like an unreachable mail server. */
      sendEmail: async () => {
        throw new Error('SMTP down');
      },
    };

    expect(await sendSecurityNotice(failing, { email: 'jane@adiutor.test' }, 'mfa_reset')).toBe(
      false,
    );
    expect(logged).toHaveBeenCalledWith(
      'Sending the "mfa_reset" security notice failed',
      expect.any(Error),
    );
  });
});
