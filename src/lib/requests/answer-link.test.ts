/**
 * @file Tests for the addresses of an email's answer links.
 */
import { describe, expect, it } from 'vitest';

import { answerLinkPath } from './answer-link';

describe('answerLinkPath', () => {
  it('is the link a button opens, or the link’s page', () => {
    expect(answerLinkPath('t0k3n', 'approve')).toBe('/answer/t0k3n/approve');
    expect(answerLinkPath('t0k3n', 'deny')).toBe('/answer/t0k3n/deny');
    expect(answerLinkPath('t0k3n')).toBe('/answer/t0k3n');
  });

  it('keeps a token in one piece of the address', () => {
    expect(answerLinkPath('a/b?c')).toBe('/answer/a%2Fb%3Fc');
  });
});
