/**
 * @file Tests for the button on an answer link's page: it answers through
 * the link with the pressed answer, then refreshes and shows the link's page
 * again; a refusal for too many tries stays on the page with its message.
 */
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceError } from '@/server/errors';
import { answerByLink } from '@/server/requests';

import form from '../../../../tests/ui/form';
import { answerLinkAction } from './actions';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/requests', () => ({ answerByLink: vi.fn() }));

/**
 * The page's form fields, as a press of one of its buttons sends them.
 *
 * @param answer - The pressed button's answer.
 * @returns The fields.
 */
const fields = (answer: string) => ({ token: 'link-token', answer });

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(redirect).mockClear();
  vi.mocked(answerByLink).mockReset();
});

describe('answerLinkAction', () => {
  it('answers through the link, then refreshes and shows the link’s page', async () => {
    vi.mocked(answerByLink).mockResolvedValue({
      state: 'used',
      reference: 'AD-142',
      number: 142,
      answer: 'deny',
    });

    await expect(answerLinkAction(null, form(fields('deny')))).rejects.toThrow('NEXT_REDIRECT');

    expect(answerByLink).toHaveBeenCalledExactlyOnceWith(
      { name: 'app context' },
      'link-token',
      'deny',
    );
    expect(redirect).toHaveBeenCalledExactlyOnceWith('/answer/link-token');
    expect(refresh).toHaveBeenCalledBefore(vi.mocked(redirect));
  });

  it('answers nothing for an answer that isn’t one', async () => {
    await expect(answerLinkAction(null, form(fields('maybe')))).rejects.toThrow('NEXT_REDIRECT');

    expect(answerByLink).not.toHaveBeenCalled();
  });

  it('stays on the page with the reason when there were too many tries', async () => {
    vi.mocked(answerByLink).mockRejectedValue(
      new ServiceError('rate_limited', 'errors.tooManyAttempts', { minutes: 3 }),
    );

    expect(await answerLinkAction(null, form(fields('approve')))).toEqual({
      ok: false,
      message: 'Too many attempts. Try again in 3 minutes.',
    });

    expect(redirect).not.toHaveBeenCalled();
  });
});
