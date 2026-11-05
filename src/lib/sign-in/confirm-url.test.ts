/**
 * @file Tests for the step-up address used before changes that need a recent
 * confirmation.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_SIGNED_IN_PATH } from '@/lib/redirect';

import confirmChangeUrl, { confirmChangeUrlFor } from './confirm-url';

/**
 * Builds a submitted form.
 *
 * @param fields - Its fields.
 * @returns The form data.
 */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  Object.entries(fields).forEach(([name, value]) => data.set(name, value));
  return data;
}

describe('confirmChangeUrl', () => {
  it('opens the step-up page in change mode, returning to the page', () => {
    expect(confirmChangeUrl('/admin/staff')).toBe(
      '/auth/verify?callbackURL=%2Fadmin%2Fstaff&for=change',
    );
    expect(confirmChangeUrl('/companies/x/members?sort=email')).toBe(
      '/auth/verify?callbackURL=%2Fcompanies%2Fx%2Fmembers%3Fsort%3Demail&for=change',
    );
  });

  it('keeps the query and the anchor inside callbackURL', () => {
    expect(confirmChangeUrl('/admin/staff?inv-page=2#invitations')).toBe(
      '/auth/verify?callbackURL=%2Fadmin%2Fstaff%3Finv-page%3D2%23invitations&for=change',
    );
  });
});

describe('confirmChangeUrlFor', () => {
  it("returns to the form's page, with its tables and section", () => {
    expect(
      confirmChangeUrlFor(form({ returnTo: '/admin/staff?inv-page=2#invitations' }), '/x'),
    ).toBe(confirmChangeUrl('/admin/staff?inv-page=2#invitations'));
  });

  it('returns to the fallback without a returnTo', () => {
    expect(confirmChangeUrlFor(form({}), '/admin/staff')).toBe(confirmChangeUrl('/admin/staff'));
  });

  it('drops an anchor that names no section', () => {
    expect(confirmChangeUrlFor(form({ returnTo: '/admin/staff#:~:text=x' }), '/x')).toBe(
      confirmChangeUrl('/admin/staff'),
    );
  });

  it.each(['https://evil.adiutor.test', '//evil.adiutor.test', '/api/auth/x'])(
    'never returns to %j',
    (returnTo) => {
      expect(confirmChangeUrlFor(form({ returnTo }), '/admin/staff')).toBe(
        confirmChangeUrl(DEFAULT_SIGNED_IN_PATH),
      );
    },
  );
});
