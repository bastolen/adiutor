/**
 * @file Tests for the safe redirect helpers: paths that stay on the site and
 * out of `/api`, as redirects and as return addresses sent to Better Auth,
 * and the sign-in page's address that goes on to one.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SIGNED_IN_PATH,
  getSafeRedirectPath,
  isSafeAppRedirect,
  isSectionId,
  sectionFromHash,
  signedInPath,
  signInPath,
  withSection,
} from './redirect';

/**
 * Fragments that don't name a section: a text fragment (which scrolls to and
 * highlights any text), what Next.js can't decode, uppercase, underscores,
 * encoded characters, `top`, one too long, and an empty one after the letter.
 */
const UNSAFE_HASHES = [
  '#:~:text=secret',
  '#invitations:~:text=secret',
  '#100%',
  '#a%20b',
  '#Invitations',
  '#invite_links',
  '#1st',
  '#-x',
  '#top',
  `#a${'b'.repeat(64)}`,
  '#café',
];

/**
 * Paths under `/api`, also once resolved or decoded, e.g. a second sign-in
 * link that would sign the browser in to another account.
 */
const API_PATHS = [
  '/api',
  '/API/x',
  '/api/',
  '/api?x=1',
  '/api/auth/magic-link/verify?token=x',
  '/api/auth/magic-link/verify?token=x&callbackURL=/dashboard',
  '/./api/x',
  '/x/../api/x',
  '/%2e/api/x',
  '/%61pi/x',
  '/api%2fx',
  '/x%2f..%2fapi',
  '/%2fapi/x',
];

describe('getSafeRedirectPath', () => {
  it('keeps same-site paths, including query strings', () => {
    expect(getSafeRedirectPath('/dashboard')).toBe('/dashboard');
    expect(getSafeRedirectPath('/dashboard/settings?tab=profile')).toBe(
      '/dashboard/settings?tab=profile',
    );
  });

  it('falls back to the default page when nothing is given', () => {
    expect(getSafeRedirectPath(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(getSafeRedirectPath(undefined)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(getSafeRedirectPath('')).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'dashboard',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '/ /evil.example',
    '/\u0000/evil.example',
    '/dashboard\\..\\..\\evil.example',
    ['java', 'script:alert(1)'].join(''),
    // Resolve to `//evil.adiutor.test`, which a browser reads as another site.
    '/.//evil.adiutor.test',
    '/x/..//evil.adiutor.test',
    // Decoded once, another site.
    '/%2F%2Fevil.adiutor.test',
    '/%5C%5Cevil.adiutor.test',
  ])('rejects %j, which could lead to another site', (value) => {
    expect(getSafeRedirectPath(value)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it.each(API_PATHS)('rejects %j, which is under /api', (value) => {
    expect(getSafeRedirectPath(value)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('rejects a path that cannot be decoded', () => {
    expect(getSafeRedirectPath('/100%')).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('keeps pages that only start like /api', () => {
    expect(getSafeRedirectPath('/apis')).toBe('/apis');
    expect(getSafeRedirectPath('/companies/api')).toBe('/companies/api');
  });

  it('keeps encoded characters and hashes as they are', () => {
    expect(getSafeRedirectPath('/companies/x?q=a%20b#members')).toBe(
      '/companies/x?q=a%20b#members',
    );
    expect(getSafeRedirectPath('/auth?callbackURL=%2Fapi%2Fx')).toBe(
      '/auth?callbackURL=%2Fapi%2Fx',
    );
  });

  it('keeps the anchor of a section, after the query', () => {
    expect(getSafeRedirectPath('/admin/settings/staff#invitations')).toBe(
      '/admin/settings/staff#invitations',
    );
    expect(getSafeRedirectPath('/admin/settings/staff?inv-page=2#invitations')).toBe(
      '/admin/settings/staff?inv-page=2#invitations',
    );
    expect(getSafeRedirectPath('/auth/verify?callbackURL=%2Fx%23invite-links')).toBe(
      '/auth/verify?callbackURL=%2Fx%23invite-links',
    );
  });

  it.each(UNSAFE_HASHES)('keeps the page but drops %j, which is no section', (hash) => {
    expect(getSafeRedirectPath(`/admin/settings/staff?inv-page=2${hash}`)).toBe(
      '/admin/settings/staff?inv-page=2',
    );
  });

  it('drops an empty fragment', () => {
    expect(getSafeRedirectPath('/admin/settings/staff#')).toBe('/admin/settings/staff');
  });

  it.each([
    '//evil.example#invitations',
    'https://evil.example/#invitations',
    '/.//evil.adiutor.test#invitations',
    '/api/x#invitations',
    '/%61pi/x#invitations',
    // Unsafe characters count anywhere, the fragment too.
    '/admin/settings/staff#a b',
    '/admin/settings/staff#a\tb',
    '/admin/settings/staff#\\evil',
  ])('still rejects %j with a section anchor', (value) => {
    expect(getSafeRedirectPath(value)).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});

describe('isSectionId', () => {
  it.each(['invitations', 'invite-links', 'two-step', 'a', `a${'b'.repeat(63)}`, 'step2'])(
    'accepts %j',
    (value) => {
      expect(isSectionId(value)).toBe(true);
    },
  );

  it.each(['', 'top', 'Invitations', 'invite_links', '1st', '-x', 'a b', `a${'b'.repeat(64)}`])(
    'refuses %j',
    (value) => {
      expect(isSectionId(value)).toBe(false);
    },
  );

  it('refuses anything but a string', () => {
    [undefined, null, 1, ['invitations']].forEach((value) => {
      expect(isSectionId(value)).toBe(false);
    });
  });
});

describe('sectionFromHash', () => {
  it('reads the section a fragment names, with or without its #', () => {
    expect(sectionFromHash('#invitations')).toBe('invitations');
    expect(sectionFromHash('invite-links')).toBe('invite-links');
  });

  it.each([...UNSAFE_HASHES, '', '#', null, undefined])('ignores %j', (hash) => {
    expect(sectionFromHash(hash)).toBeNull();
  });
});

describe('withSection', () => {
  it('points a path at a section, after its query', () => {
    expect(withSection('/admin/settings/staff', 'invitations')).toBe(
      '/admin/settings/staff#invitations',
    );
    expect(withSection('/admin/settings/staff?inv-page=2', 'invitations')).toBe(
      '/admin/settings/staff?inv-page=2#invitations',
    );
  });

  it('replaces the fragment the path had', () => {
    expect(withSection('/admin/settings/staff#invite', 'invitations')).toBe(
      '/admin/settings/staff#invitations',
    );
  });

  it.each([null, undefined, '', 'top', ':~:text=x', 'Invitations'])(
    'leaves the path alone for %j',
    (section) => {
      expect(withSection('/admin/settings/staff#invite', section)).toBe(
        '/admin/settings/staff#invite',
      );
    },
  );
});

describe('isSafeAppRedirect', () => {
  it.each([
    '/dashboard',
    "/x?q=O'Brien",
    '/companies/x#y',
    '/companies/x?q=a%20b#members',
    '/account?verified=1#email',
    '/admin/settings/staff#',
    '/auth?callbackURL=%2Fdashboard',
    '/auth?callbackURL=%2Fx%23%3A~%3Atext%3Dy',
    '/auth/email-link?token=abc&callbackURL=%2Fdashboard',
  ])('passes %j, a page of the app, exactly as sent', (value) => {
    expect(isSafeAppRedirect(value)).toBe(true);
  });

  it.each([
    'https://evil.adiutor.test',
    'https://adiutor.test/dashboard',
    '//evil.adiutor.test',
    '/\\evil.adiutor.test',
    '/dashboard\\x',
    'dashboard',
    '',
    '/\t/evil.adiutor.test',
    '/.//evil.adiutor.test',
    '/%2F%2Fevil.adiutor.test',
    '/100%',
    '/admin/settings/staff#a b',
    '/api/x#invitations',
    ...API_PATHS,
    ...UNSAFE_HASHES.map((hash) => `/admin/settings/staff${hash}`),
  ])('refuses %j', (value) => {
    expect(isSafeAppRedirect(value)).toBe(false);
  });

  it('refuses anything but a string', () => {
    [undefined, null, 1, ['/dashboard'], { path: '/dashboard' }].forEach((value) => {
      expect(isSafeAppRedirect(value)).toBe(false);
    });
  });

  it('passes what getSafeRedirectPath returns', () => {
    [
      "/x?q=O'Brien",
      '/companies/x?q=a b#members',
      '/caf\u00e9',
      '/api/x',
      '/x#:~:text=y',
      '/x#100%',
    ].forEach((value) => {
      expect(isSafeAppRedirect(getSafeRedirectPath(value))).toBe(true);
    });
  });
});

describe('signedInPath', () => {
  it('goes on to the requested page, with its query string and section', () => {
    expect(signedInPath('/account?tab=security')).toBe('/account?tab=security');
    expect(signedInPath('/admin/settings/staff#invitations')).toBe(
      '/admin/settings/staff#invitations',
    );
    expect(signedInPath('/auth/verify?callbackURL=%2Faccount')).toBe(
      '/auth/verify?callbackURL=%2Faccount',
    );
  });

  it('falls back to the default page for nothing, or another site', () => {
    expect(signedInPath(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(signedInPath('https://evil.adiutor.test')).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('falls back to the default page for an endpoint under /api', () => {
    expect(signedInPath('/api/auth/magic-link/verify?token=x&callbackURL=%2Fdashboard')).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
  });

  it.each(['/auth', '/auth/', '/auth?callbackURL=%2Fauth%3FcallbackURL%3D%252Faccount'])(
    'never goes back to the sign-in page (%j)',
    (value) => {
      expect(signedInPath(value)).toBe(DEFAULT_SIGNED_IN_PATH);
    },
  );
});

describe('signInPath', () => {
  it('goes on to the page, encoded so it stays one parameter', () => {
    expect(signInPath('/dashboard')).toBe('/auth?callbackURL=%2Fdashboard');
    expect(signInPath('/requests/142?entry=019a1b2c&x=1#entry-019a1b2c')).toBe(
      '/auth?callbackURL=%2Frequests%2F142%3Fentry%3D019a1b2c%26x%3D1%23entry-019a1b2c',
    );
  });

  it('puts a notice first', () => {
    expect(signInPath('/companies/x', { notice: 'joined-mfa-required' })).toBe(
      '/auth?notice=joined-mfa-required&callbackURL=%2Fcompanies%2Fx',
    );
  });
});
