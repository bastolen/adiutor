/**
 * @file Tests for which paths the proxy runs on, and which it lets through
 * signed out.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { defined } from '@/lib/defined';

import proxy, { config, isPublicPath } from './proxy';

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
  it('allows the sign-in, invitation, join, answer and setup pages, the brand images, the auth API and the health check', () => {
    [
      '/answer/abc',
      '/branding/logo',
      '/branding/icon',
      '/answer/abc/approve',
      '/auth',
      '/auth/forgot-password',
      '/invite/abc',
      '/join/abc',
      '/setup',
      '/api/auth/sign-in/email',
      '/api/health',
      '/api/jobs',
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
      '/answers',
      '/brandings',
      '/api/other',
      '/api/healthy',
      '/api/jobsite',
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

  it('gives a file a fixed policy that runs nothing (an image one its viewer’s styles), and a page its own with a nonce', () => {
    /**
     * Runs the proxy for a signed-in request.
     *
     * @param path - The request path.
     * @returns The policy it sends.
     */
    const policyFor = (path: string) =>
      proxy(
        new NextRequest(new URL(path, 'http://localhost:3000'), {
          headers: { cookie: 'better-auth.session_token=token.signature' },
        }),
      ).headers.get('content-security-policy');

    expect(policyFor('/attachments/0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a')).toBe(
      "default-src 'none'; sandbox",
    );
    expect(policyFor('/branding/logo')).toBe(
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    );
    expect(policyFor('/requests/1')).toMatch(/script-src 'self' 'nonce-/);
  });
});

describe('the matcher', () => {
  /** The paths the proxy runs on, as Next.js reads its matcher. */
  const runsOn = new RegExp(`^${defined(config.matcher[0], 'the matcher')}$`);

  it('leaves out Next.js\u2019s files, the static files and the attachments\u2019 upload', () => {
    ['/_next/static/chunk.js', '/favicon.ico', '/brand/logo.svg', '/api/attachments'].forEach(
      (path) => expect(runsOn.test(path), path).toBe(false),
    );
  });

  it('runs on everything else, the paths next to the upload included', () => {
    [
      '/',
      '/requests/1',
      '/attachments/0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a',
      '/api/attachments/x',
      '/api/attachmentsx',
      '/api/jobs',
      '/branding/icon',
      '/icon.svg',
      '/companies/x.png',
    ].forEach((path) => expect(runsOn.test(path), path).toBe(true));
  });
});
