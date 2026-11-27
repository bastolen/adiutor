/**
 * @file Tests for the Content Security Policy: only scripts with the
 * request's nonce run, and inline event handlers never do.
 */
import { describe, expect, it } from 'vitest';

import { defined } from '@/lib/defined';

import { contentSecurityPolicy, createNonce } from './csp';

/**
 * Splits a policy into its directives.
 *
 * @param policy - The header value.
 * @returns Directive name to its sources.
 */
function directives(policy: string): Record<string, string> {
  return Object.fromEntries(
    policy.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ');
      return [name, sources.join(' ')];
    }),
  );
}

describe('createNonce', () => {
  it('makes a fresh 128-bit value every time', () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    nonces.forEach((nonce) => {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    });
  });
});

describe('contentSecurityPolicy', () => {
  it('only lets scripts with the nonce run, and no inline handlers', () => {
    const policy = directives(contentSecurityPolicy('abc123', false));
    expect(policy['script-src']).toBe("'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy['script-src']).not.toContain('unsafe');
    expect(policy['script-src-attr']).toBe("'none'");
  });

  it('puts script-src before script-src-attr, where Next.js looks for the nonce', () => {
    const names = contentSecurityPolicy('abc123', false)
      .split('; ')
      .map((directive) => defined(directive.split(' ')[0], 'the directive name'));
    expect(names.findIndex((name) => name.startsWith('script-src'))).toBe(
      names.indexOf('script-src'),
    );
  });

  it('allows eval only on the development server', () => {
    expect(directives(contentSecurityPolicy('abc123', true))['script-src']).toBe(
      "'self' 'nonce-abc123' 'strict-dynamic' 'unsafe-eval'",
    );
  });

  it('keeps the other protections', () => {
    expect(directives(contentSecurityPolicy('abc123', false))).toMatchObject({
      'default-src': "'self'",
      'style-src': "'self' 'unsafe-inline'",
      'object-src': "'none'",
      'base-uri': "'self'",
      'form-action': "'self'",
      'frame-ancestors': "'none'",
    });
  });

  it('lets media load only from Adiutor itself and the page’s own blob: addresses', () => {
    expect(directives(contentSecurityPolicy('abc123', false))['media-src']).toBe("'self' blob:");
  });
});
