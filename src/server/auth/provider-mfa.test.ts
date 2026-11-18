/**
 * @file Tests for asking the providers about two-factor authentication:
 * reading their answers, and the time limit on asking.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  githubHasTwoFactor,
  PROVIDER_MFA_CHECK_TIMEOUT_MS,
  PROVIDER_MFA_CHECKS,
} from './provider-mfa';

afterEach(() => {
  // Puts back the real `fetch` and `AbortSignal.timeout`.
  vi.restoreAllMocks();
});

describe('githubHasTwoFactor', () => {
  it('is true only when GitHub says two-factor authentication is on', () => {
    expect(githubHasTwoFactor({ login: 'adiutor', two_factor_authentication: true })).toBe(true);
    expect(githubHasTwoFactor({ two_factor_authentication: false })).toBe(false);
    expect(githubHasTwoFactor({ login: 'adiutor' })).toBeNull();
    expect(githubHasTwoFactor({ two_factor_authentication: 'yes' })).toBeNull();
    expect(githubHasTwoFactor(null)).toBeNull();
  });
});

describe('the GitHub check', () => {
  it('asks GitHub with a time limit of 3 seconds', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ two_factor_authentication: true }));

    await expect(PROVIDER_MFA_CHECKS.github('adiutor-tests-token')).resolves.toBe(true);

    expect(PROVIDER_MFA_CHECK_TIMEOUT_MS).toBe(3_000);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(PROVIDER_MFA_CHECK_TIMEOUT_MS);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://api.github.com/user');
    expect(init?.signal).toBe(timeout.mock.results[0]?.value);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('gives up with a TimeoutError when GitHub doesn’t answer in time', async () => {
    // The time limit, run out by hand: the test doesn't wait the 3 seconds.
    const limit = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(limit.signal);
    // A GitHub that never answers: the request only ends when its signal says so.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason);
          });
        }),
    );

    const answer = PROVIDER_MFA_CHECKS.github('adiutor-tests-token');
    limit.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    await expect(answer).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
