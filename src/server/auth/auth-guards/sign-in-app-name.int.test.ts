/**
 * @file Integration tests for the label of new authenticator entries and
 * passkeys, against the test database: the staff's name with Adiutor's after
 * it, just Adiutor while that's the staff's name, Better Auth's own when the
 * name can't be read, and nothing for any other endpoint.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveSettings } from '../../../../tests/integration/helpers';
import { signInAppNameFor } from './sign-in-app-name';
import { db, request } from './test-helpers';

/** Whether reading the staff's name fails, as it does with the database down. */
const nameRead = vi.hoisted(() => ({ fails: false }));

vi.mock('../../people/staff-name', async (original) => {
  const actual = await original<typeof import('../../people/staff-name')>();
  return {
    /**
     * Reads the staff's name, or fails while the test says so.
     *
     * @param database - The database.
     * @returns The name.
     */
    default: (database: Parameters<typeof actual.default>[0]) =>
      nameRead.fails ? Promise.reject(new Error('the database is down')) : actual.default(database),
  };
});

afterEach(() => {
  nameRead.fails = false;
});

describe('signInAppNameFor', () => {
  it.each(['/two-factor/enable', '/two-factor/get-totp-uri', '/passkey/generate-register-options'])(
    'labels what %s creates with the staff’s name and Adiutor’s',
    async (path) => {
      await saveSettings(db, { 'staff.name': 'Adiutor Tests Support' });

      expect(await signInAppNameFor(request(path))).toBe('Adiutor Tests Support (Adiutor)');
    },
  );

  it('labels it just Adiutor while that’s the staff’s name', async () => {
    expect(await signInAppNameFor(request('/two-factor/enable'))).toBe('Adiutor');
  });

  it('leaves every other endpoint alone', async () => {
    await saveSettings(db, { 'staff.name': 'Adiutor Tests Support' });

    expect(await signInAppNameFor(request('/sign-in/email'))).toBeUndefined();
    expect(await signInAppNameFor(request('/passkey/verify-registration'))).toBeUndefined();
  });

  it('leaves Better Auth’s own label when the staff’s name can’t be read, and says so', async () => {
    nameRead.fails = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await signInAppNameFor(request('/two-factor/enable'))).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'The staff’s name could not be read; a new sign-in entry is labelled Adiutor.',
    );
    warn.mockRestore();
  });
});
