/**
 * @file Tests for the link in sign-in emails: it goes to the confirmation
 * page, with the same token and return addresses as Better Auth's link.
 */
import { describe, expect, it } from 'vitest';

import { emailLinkUrl } from './email-link';

describe('emailLinkUrl', () => {
  it('links to the confirmation page with the token and return addresses', () => {
    const magicLink =
      'https://adiutor.dev/api/auth/magic-link/verify?token=abc&callbackURL=%2Fadmin%2Fusers&errorCallbackURL=%2Fauth%3Ferror%3Dlink';
    const link = new URL(emailLinkUrl(magicLink, 'https://adiutor.dev'));

    expect(link.origin).toBe('https://adiutor.dev');
    expect(link.pathname).toBe('/auth/email-link');
    expect(Object.fromEntries(link.searchParams)).toEqual({
      token: 'abc',
      callbackURL: '/admin/users',
      errorCallbackURL: '/auth?error=link',
    });
  });

  it('uses the app URL and leaves out anything else', () => {
    const magicLink = 'http://localhost:3000/api/auth/magic-link/verify?token=abc&other=1';
    expect(emailLinkUrl(magicLink, 'https://adiutor.dev')).toBe(
      'https://adiutor.dev/auth/email-link?token=abc',
    );
  });
});
