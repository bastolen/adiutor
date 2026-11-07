/**
 * @file Tests for which paths the proxy lets through signed out.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import proxy, { isPublicPath } from './proxy';

/**
 * Runs the proxy for a signed-out request.
 *
 * @param path - The request path.
 * @returns The proxy's response.
 */
function signedOut(path: string) {
  return proxy(new NextRequest(new URL(path, 'http://localhost:3000')));
}

describe('isPublicPath', () => {
  it('allows the sign-in, invitation, join and setup pages and the auth API', () => {
    [
      '/auth',
      '/auth/forgot-password',
      '/invite/abc',
      '/join/abc',
      '/setup',
      '/api/auth/sign-in/email',
    ].forEach((path) => expect(isPublicPath(path), path).toBe(true));
  });

  it('protects everything else, including look-alike paths', () => {
    [
      '/',
      '/dashboard',
      '/companies/1',
      '/admin',
      '/account',
      '/authors',
      '/setups',
      '/api/other',
    ].forEach((path) => expect(isPublicPath(path), path).toBe(false));
  });
});

describe('proxy', () => {
  it('sends signed-out visitors to sign in, remembering the page', () => {
    const response = signedOut('/companies/1/members?tab=links');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/auth?callbackURL=%2Fcompanies%2F1%2Fmembers%3Ftab%3Dlinks',
    );
  });

  it('sends the home page to sign in without a callback', () => {
    expect(signedOut('/').headers.get('location')).toBe('http://localhost:3000/auth');
  });

  it('answers protected API routes with 401', () => {
    expect(signedOut('/api/something').status).toBe(401);
  });

  it('lets public pages through', () => {
    expect(signedOut('/invite/abc').headers.get('location')).toBeNull();
  });
});
