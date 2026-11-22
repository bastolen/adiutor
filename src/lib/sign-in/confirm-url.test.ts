/**
 * @file Tests for the step-up address used before changes that need a recent
 * confirmation.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_SIGNED_IN_PATH } from '@/lib/redirect';

import form from '../../../tests/ui/form';
import confirmChangeUrl, { confirmChangeUrlFor, confirmStrongUrlFor } from './confirm-url';

describe('confirmChangeUrl', () => {
  it('opens the step-up page in change mode, returning to the page', () => {
    expect(confirmChangeUrl('/admin/settings/staff')).toBe(
      '/auth/verify?callbackURL=%2Fadmin%2Fsettings%2Fstaff&for=change',
    );
    expect(confirmChangeUrl('/companies/x/members?sort=email')).toBe(
      '/auth/verify?callbackURL=%2Fcompanies%2Fx%2Fmembers%3Fsort%3Demail&for=change',
    );
  });

  it('keeps the query and the anchor inside callbackURL', () => {
    expect(confirmChangeUrl('/admin/settings/staff?inv-page=2#invitations')).toBe(
      '/auth/verify?callbackURL=%2Fadmin%2Fsettings%2Fstaff%3Finv-page%3D2%23invitations&for=change',
    );
  });
});

describe('confirmChangeUrlFor', () => {
  it("returns to the form's page, with its tables and section", () => {
    expect(
      confirmChangeUrlFor(form({ returnTo: '/admin/settings/staff?inv-page=2#invitations' }), '/x'),
    ).toBe(confirmChangeUrl('/admin/settings/staff?inv-page=2#invitations'));
  });

  it('returns to the fallback without a returnTo', () => {
    expect(confirmChangeUrlFor(form({}), '/admin/settings/staff')).toBe(
      confirmChangeUrl('/admin/settings/staff'),
    );
  });

  it('drops an anchor that names no section', () => {
    expect(confirmChangeUrlFor(form({ returnTo: '/admin/settings/staff#:~:text=x' }), '/x')).toBe(
      confirmChangeUrl('/admin/settings/staff'),
    );
  });

  it.each(['https://evil.adiutor.test', '//evil.adiutor.test', '/api/auth/x'])(
    'never returns to %j',
    (returnTo) => {
      expect(confirmChangeUrlFor(form({ returnTo }), '/admin/settings/staff')).toBe(
        confirmChangeUrl(DEFAULT_SIGNED_IN_PATH),
      );
    },
  );
});

describe('confirmStrongUrlFor', () => {
  it("opens the step-up page in strong mode, returning to the form's page and card", () => {
    expect(
      confirmStrongUrlFor(form({ returnTo: '/admin/users/u1?d-page=2#sign-in-as' }), '/x'),
    ).toBe('/auth/verify?callbackURL=%2Fadmin%2Fusers%2Fu1%3Fd-page%3D2%23sign-in-as&for=strong');
  });

  it('returns to the fallback without a returnTo, and never off the site', () => {
    expect(confirmStrongUrlFor(form({}), '/admin/users/u1')).toBe(
      '/auth/verify?callbackURL=%2Fadmin%2Fusers%2Fu1&for=strong',
    );
    expect(confirmStrongUrlFor(form({ returnTo: '//evil.adiutor.test' }), '/x')).toBe(
      `/auth/verify?callbackURL=${encodeURIComponent(DEFAULT_SIGNED_IN_PATH)}&for=strong`,
    );
  });
});
