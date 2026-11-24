/**
 * @file Tests for the part of the sign-in error page that depends on the
 * error: it records it, explains it without its code and shows the
 * reference to send to an administrator.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Actor } from '@/server/actor';
import { recordSignInError } from '@/server/auth/sign-in-errors';
import { getOptionalActor } from '@/server/authz';

import SignInErrorDetails from './sign-in-error-details';

vi.mock('@/server/app-context', () => ({ default: {} }));
vi.mock('@/server/authz', () => ({ getOptionalActor: vi.fn() }));
vi.mock('@/server/auth/sign-in-errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/sign-in-errors')>()),
  recordSignInError: vi.fn(),
}));

afterEach(() => {
  vi.mocked(getOptionalActor).mockReset();
  vi.mocked(recordSignInError).mockReset();
});

/** When the test error happened. */
const AT = new Date('2026-10-28T18:40:00Z');

/**
 * Renders the details for a query string.
 *
 * @param query - The page's query parameters.
 */
async function renderDetails(query: Record<string, string | string[]>) {
  vi.mocked(recordSignInError).mockResolvedValue({ reference: '7KQ2-M9XD', at: AT });
  render(await SignInErrorDetails({ searchParams: Promise.resolve(query) }));
}

describe('SignInErrorDetails', () => {
  it('records the error with its description and who is signed in', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue({ id: 'jane-id' } as Actor);
    await renderDetails({ error: 'state_mismatch', error_description: 'State mismatch' });

    expect(recordSignInError).toHaveBeenCalledWith(expect.anything(), {
      code: 'state_mismatch',
      description: 'State mismatch',
      userId: 'jane-id',
    });
  });

  it('records the staff member, not the user, while signed in as a user', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue({
      id: 'jane-id',
      signedInAs: { staffId: 'sam-id' },
    } as Actor);
    await renderDetails({ error: 'state_mismatch' });

    expect(recordSignInError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'sam-id' }),
    );
  });

  it('explains the error without its code', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue(null);
    await renderDetails({ error: 'state_mismatch' });

    expect(screen.getByText(/took too long, or was started in another tab/)).toBeInTheDocument();
    expect(screen.queryByText(/state_mismatch/)).not.toBeInTheDocument();
  });

  it('shows the reference and when it happened, to copy for an administrator', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue(null);
    await renderDetails({ error: 'access_denied' });

    expect(screen.getByText(/send this reference to an administrator/)).toBeInTheDocument();
    expect(screen.getByText('7KQ2-M9XD')).toBeInTheDocument();
    expect(screen.getByText('Oct 28, 2026, 6:40 PM')).toHaveAttribute('datetime', AT.toISOString());
    expect(screen.getByRole('button', { name: 'Copy reference' })).toBeInTheDocument();
  });

  it('records a missing, repeated or odd code as UNKNOWN, with no one signed in', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue(null);
    await renderDetails({ error: ['a', 'b'] });
    await renderDetails({ error: '<b>hi</b>' });

    expect(vi.mocked(recordSignInError).mock.calls.map(([, error]) => error)).toEqual([
      { code: 'UNKNOWN', description: null, userId: null },
      { code: 'UNKNOWN', description: null, userId: null },
    ]);
    expect(screen.getAllByText(/Something went wrong while signing you in/)).toHaveLength(2);
  });
});
