/**
 * @file Tests for the addresses of the link in an email about a request.
 */
import { describe, expect, it } from 'vitest';

import {
  REQUEST_LINK_DAYS,
  REQUEST_LINK_PAGE,
  REQUEST_LINK_URL_PATH,
  requestLinkPagePath,
  requestLinkPath,
} from './request-link';

describe('request links', () => {
  it('work for 14 days', () => {
    expect(REQUEST_LINK_DAYS).toBe(14);
  });

  it("sign in at Better Auth's endpoint, with the token in the query", () => {
    expect(REQUEST_LINK_URL_PATH).toBe('/api/auth/request-link/sign-in');
    expect(requestLinkPath('abc-_123')).toBe('/api/auth/request-link/sign-in?token=abc-_123');
  });

  it("mark the confirmation page's Continue", () => {
    expect(requestLinkPath('abc', { confirmed: true })).toBe(
      '/api/auth/request-link/sign-in?token=abc&confirmed=1',
    );
  });

  it('encode the token', () => {
    expect(requestLinkPath('a&b=c')).toBe('/api/auth/request-link/sign-in?token=a%26b%3Dc');
    expect(requestLinkPagePath('a&b')).toBe(`${REQUEST_LINK_PAGE}?token=a%26b`);
  });

  it('confirm on a page of the app', () => {
    expect(requestLinkPagePath('abc')).toBe('/auth/request-link?token=abc');
  });

  it('pass the entry they point at on, and leave out anything else', () => {
    const entry = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
    expect(requestLinkPath('abc', { entry })).toBe(
      `/api/auth/request-link/sign-in?token=abc&entry=${entry}`,
    );
    expect(requestLinkPath('abc', { confirmed: true, entry })).toBe(
      `/api/auth/request-link/sign-in?token=abc&entry=${entry}&confirmed=1`,
    );
    expect(requestLinkPagePath('abc', { entry })).toBe(
      `/auth/request-link?token=abc&entry=${entry}`,
    );
    expect(requestLinkPath('abc', { entry: '//adiutor.dev' })).toBe(
      '/api/auth/request-link/sign-in?token=abc',
    );
  });
});
