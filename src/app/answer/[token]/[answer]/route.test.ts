/**
 * @file Tests for the Approve and Deny links of an email: a person's click
 * answers and ends on the link's page; any other visit (a mail scanner, a
 * `HEAD` request) answers nothing and ends on the page with a button for the
 * answer; an answer that isn't one goes to the page; a refusal for too many
 * tries shows the button again. The address with its token is never cached
 * or sent as a referrer.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceError } from '@/server/errors';
import { answerByLink } from '@/server/requests';

import { GET } from './route';

vi.mock('@/server/app-context', () => ({
  default: { name: 'app context', baseUrl: 'https://adiutor.test' },
}));
vi.mock('@/server/requests', () => ({ answerByLink: vi.fn() }));

/**
 * Opens a link as a browser would.
 *
 * @param answer - The answer in the link.
 * @param options - How it's opened.
 * @param options.click - Whether a person clicked it (`Sec-Fetch-User: ?1`).
 * @param options.method - The request's method.
 * @returns The response.
 */
function open(answer: string, { click = true, method = 'GET' } = {}) {
  const headers = new Headers({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' });
  if (click) {
    headers.set('sec-fetch-user', '?1');
  }
  return GET(
    new NextRequest(`https://adiutor.test/answer/link-token/${answer}`, { headers, method }),
    {
      params: Promise.resolve({ token: 'link-token', answer }),
    },
  );
}

beforeEach(() => {
  vi.mocked(answerByLink).mockReset();
});

describe('GET /answer/[token]/[answer]', () => {
  it('answers on a person’s click, then shows the link’s page', async () => {
    const response = await open('approve');

    expect(answerByLink).toHaveBeenCalledExactlyOnceWith(
      { name: 'app context', baseUrl: 'https://adiutor.test' },
      'link-token',
      'approve',
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://adiutor.test/answer/link-token');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('answers nothing for a visit without a click, and shows the button for the answer', async () => {
    const response = await open('deny', { click: false });

    expect(answerByLink).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(
      'https://adiutor.test/answer/link-token?answer=deny',
    );
  });

  it('answers nothing for a HEAD request', async () => {
    await open('approve', { method: 'HEAD' });

    expect(answerByLink).not.toHaveBeenCalled();
  });

  it('goes to the link’s page for an answer that isn’t one', async () => {
    const response = await open('maybe');

    expect(answerByLink).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('https://adiutor.test/answer/link-token');
  });

  it('shows the button again when there were too many tries', async () => {
    vi.mocked(answerByLink).mockRejectedValue(
      new ServiceError('rate_limited', 'errors.tooManyAttempts', { minutes: 3 }),
    );

    const response = await open('approve');

    expect(response.headers.get('location')).toBe(
      'https://adiutor.test/answer/link-token?answer=approve',
    );
  });

  it('lets an unexpected error through', async () => {
    vi.mocked(answerByLink).mockRejectedValue(new Error('database down'));

    await expect(open('approve')).rejects.toThrow('database down');
  });
});
