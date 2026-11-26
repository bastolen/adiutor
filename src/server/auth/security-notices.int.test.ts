/**
 * @file Integration tests for the notice sent straight away to a deleted
 * account's address: in the language the account saved, else Adiutor's
 * default, else English (US); its time in the zone the account saved, else
 * Adiutor's default; never naming a device; and never throwing.
 * The queued notices are tested with their job
 * (`src/server/jobs/queued/security-notice.int.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import {
  createStaffSettings,
  emailLanguage,
  inLanguage,
  saveSettings,
  setupTestContext,
} from '../../../tests/integration/helpers';
import { sendAccountDeletedNotice } from './security-notices';

const { ctx, db, sent } = setupTestContext();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendAccountDeletedNotice', () => {
  it('writes in the language the account saved, not the request’s', async () => {
    await sendAccountDeletedNotice(inLanguage(ctx, 'en-US'), 'gone@adiutor.test', 'es-ES', null);

    expect(sent.map(({ to }) => to)).toEqual(['gone@adiutor.test']);
    expect(defined(sent[0], 'the notice').subject).toBe('Se ha eliminado tu cuenta en Adiutor');
  });

  it('uses Adiutor’s default language for an account on Default, else English (US) before setup', async () => {
    await sendAccountDeletedNotice(ctx, 'gone@adiutor.test', null, null);
    await createStaffSettings(db, 'Adiutor Tests', 'nl-NL');
    await sendAccountDeletedNotice(ctx, 'gone@adiutor.test', null, null);

    expect(sent.map(emailLanguage)).toEqual(['en-US', 'nl-NL']);
  });

  it('gives the time in the zone the account saved, else in Adiutor’s default zone', async () => {
    await sendAccountDeletedNotice(ctx, 'gone@adiutor.test', 'en-US', 'America/New_York');
    await createStaffSettings(db, 'Adiutor Tests', 'en-US');
    await saveSettings(db, { 'staff.default_time_zone': 'Asia/Kolkata' });
    await sendAccountDeletedNotice(ctx, 'gone@adiutor.test', 'en-US', null);

    const [inSaved, inDefault] = sent.map(({ text }) => text);
    expect(inSaved).toMatch(/When: .+ (EST|EDT)/);
    expect(inDefault).toContain('GMT+5:30');
  });

  it('never names a device, even when the request has one', async () => {
    const fromBrowser = {
      ...ctx,
      /**
       * Pretends the request came from Firefox on Windows at a known IP address.
       *
       * @returns The request info.
       */
      requestInfo: async () => ({
        ip: '203.0.113.9',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
      }),
    };

    await sendAccountDeletedNotice(fromBrowser, 'gone@adiutor.test', 'en-US', null);

    expect(defined(sent[0], 'the notice').text).not.toContain('203.0.113.9');
  });

  it('never throws: a failed send is logged by its codes only and returns false', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = {
      ...ctx,
      /** Fails like an unreachable mail server. */
      sendEmail: async () => {
        throw Object.assign(new Error('SMTP down for gone@adiutor.test'), {
          code: 'ECONNECTION',
        });
      },
    };

    expect(await sendAccountDeletedNotice(failing, 'gone@adiutor.test', 'en-US', null)).toBe(false);
    expect(logged).toHaveBeenCalledWith('Sending the "account_deleted" security notice failed', {
      code: 'ECONNECTION',
      responseCode: null,
    });
  });
});
