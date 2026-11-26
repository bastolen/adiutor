/**
 * @file Tests for the rules about a webhook's address that the server and
 * the browser share.
 */
import { describe, expect, it } from 'vitest';

import { WEBHOOK_URL_MAX_LENGTH } from './input-rules';
import { webhookUrlProblem } from './webhooks';

describe('webhookUrlProblem', () => {
  it('accepts https addresses, with a port, path and query', () => {
    [
      'https://hooks.adiutor.dev/in',
      'https://hooks.adiutor.dev:8443/in/123?token=abc',
      'https://203.0.113.10/hook',
    ].forEach((url) => {
      expect(webhookUrlProblem(url, { production: true }), url).toBeNull();
    });
  });

  it('accepts plain http to another computer only outside production', () => {
    expect(webhookUrlProblem('http://hooks.adiutor.dev/in', { production: false })).toBeNull();
    expect(webhookUrlProblem('http://hooks.adiutor.dev/in', { production: true })).toBe('insecure');
    expect(webhookUrlProblem('http://127.0.0.1:4000/hook', { production: true })).toBeNull();
  });

  it('refuses what isn’t a web address', () => {
    expect(webhookUrlProblem('hooks.adiutor.dev', { production: false })).toBe('invalid');
    expect(webhookUrlProblem('', { production: false })).toBe('invalid');
    expect(webhookUrlProblem('ftp://hooks.adiutor.dev', { production: false })).toBe('scheme');
    expect(webhookUrlProblem('file:///etc/passwd', { production: false })).toBe('scheme');
    // eslint-disable-next-line no-script-url -- the test checks that such an address is refused
    expect(webhookUrlProblem('javascript:alert(1)', { production: false })).toBe('scheme');
  });

  it('refuses a user name or password in the address', () => {
    expect(
      webhookUrlProblem('https://user:secret@hooks.adiutor.dev/in', { production: false }),
    ).toBe('credentials');
    expect(webhookUrlProblem('https://user@hooks.adiutor.dev/in', { production: false })).toBe(
      'credentials',
    );
  });

  it('refuses an address that’s too long, before parsing it', () => {
    const url = `https://hooks.adiutor.dev/${'a'.repeat(WEBHOOK_URL_MAX_LENGTH)}`;
    expect(webhookUrlProblem(url, { production: false })).toBe('too_long');
  });
});
