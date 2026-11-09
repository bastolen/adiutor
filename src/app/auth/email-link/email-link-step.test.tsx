/**
 * @file Tests for the content of the page sign-in emails link to: which step
 * it shows for an incomplete, unusable or valid link, too many links that
 * couldn't be used, and whoever is signed in.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Actor } from '@/server/actor';
import { getEmailLinkPreview } from '@/server/auth/email-links';
import { getOptionalActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';

import EmailLinkStep from './email-link-step';

vi.mock('next/navigation', () => ({
  /**
   * Mocked query string.
   *
   * @returns A link with a token.
   */
  useSearchParams: () => new URLSearchParams({ token: 'abc', callbackURL: '/dashboard' }),
}));
vi.mock('@/server/app-context', () => ({ default: {} }));
vi.mock('@/server/authz', () => ({ getOptionalActor: vi.fn() }));
vi.mock('@/server/auth/email-links', () => ({ getEmailLinkPreview: vi.fn() }));

afterEach(() => {
  vi.mocked(getOptionalActor).mockReset();
  vi.mocked(getEmailLinkPreview).mockReset();
});

/** The account the test link signs in to. */
const JANE = { userId: 'jane-id', name: 'Jane Tester', email: 'jane@adiutor.test' };

/**
 * Renders the step for a query string.
 *
 * @param query - The page's query parameters.
 */
async function renderStep(query: Record<string, string>) {
  render(await EmailLinkStep({ searchParams: Promise.resolve(query) }));
}

/**
 * A signed-in user, as `getOptionalActor` returns them (only the fields the page reads).
 *
 * @param id - Their ID.
 * @param name - Their name.
 * @param email - Their address.
 * @returns The actor.
 */
function actor(id: string, name: string, email: string): Actor {
  return { id, name, email } as Actor;
}

describe('EmailLinkStep', () => {
  it('explains an incomplete link without looking anything up', async () => {
    await renderStep({ callbackURL: '/dashboard' });

    expect(screen.getByRole('alert')).toHaveTextContent('This sign-in link is incomplete.');
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      '/auth?callbackURL=%2Fdashboard',
    );
    expect(getEmailLinkPreview).not.toHaveBeenCalled();
  });

  it('treats an empty token as incomplete too', async () => {
    await renderStep({ token: '' });

    expect(screen.getByRole('alert')).toHaveTextContent('This sign-in link is incomplete.');
    expect(getEmailLinkPreview).not.toHaveBeenCalled();
  });

  it("says a link that can't be used can't be used, the same for every reason", async () => {
    vi.mocked(getEmailLinkPreview).mockResolvedValue(null);
    await renderStep({ token: 'abc', callbackURL: '/companies/x' });

    expect(screen.getByRole('heading', { name: "This link can't be used" })).toBeInTheDocument();
    expect(screen.getByText(/sign-in links work once, for 5 minutes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue signing in' })).not.toBeInTheDocument();
    // Signing in again goes where the link would have.
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      '/auth?callbackURL=%2Fcompanies%2Fx',
    );
  });

  it('says why Better Auth refused the link when it came back here with a reason', async () => {
    vi.mocked(getEmailLinkPreview).mockResolvedValue(null);
    await renderStep({ token: 'abc', error: 'new_user_signup_disabled' });

    expect(screen.getByRole('heading', { name: "This link can't be used" })).toBeInTheDocument();
    expect(
      screen.getByText(/There's no Adiutor account for that email address/),
    ).toBeInTheDocument();
  });

  it.each(['INVALID_TOKEN', 'not-a-code'])(
    'keeps the usual explanation for a used or expired link, or an unknown code (%s)',
    async (error) => {
      vi.mocked(getEmailLinkPreview).mockResolvedValue(null);
      await renderStep({ token: 'abc', error });

      expect(screen.getByText(/sign-in links work once, for 5 minutes/)).toBeInTheDocument();
    },
  );

  it('offers no way to continue after too many links that could not be used', async () => {
    vi.mocked(getEmailLinkPreview).mockRejectedValue(
      new ServiceError('rate_limited', 'errors.tooManyAttempts', { minutes: 12 }),
    );
    await renderStep({ token: 'abc', callbackURL: 'https://evil.adiutor.test' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 12 minutes.',
    );
    // Only paths in the app are kept.
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      '/auth?callbackURL=%2Fdashboard',
    );
    expect(screen.queryByRole('button', { name: 'Continue signing in' })).not.toBeInTheDocument();
  });

  it('lets other errors through', async () => {
    vi.mocked(getEmailLinkPreview).mockRejectedValue(new Error('database down'));

    await expect(
      EmailLinkStep({ searchParams: Promise.resolve({ token: 'abc' }) }),
    ).rejects.toThrow('database down');
  });

  it('names the account to continue as, signed out', async () => {
    vi.mocked(getEmailLinkPreview).mockResolvedValue(JANE);
    vi.mocked(getOptionalActor).mockResolvedValue(null);
    await renderStep({ token: 'abc' });

    expect(getEmailLinkPreview).toHaveBeenCalledWith(expect.anything(), 'abc');
    expect(screen.getByText('Jane Tester')).toBeInTheDocument();
    expect(screen.getByText('jane@adiutor.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue signing in' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('warns whoever else is signed in, with their own full address', async () => {
    vi.mocked(getEmailLinkPreview).mockResolvedValue(JANE);
    vi.mocked(getOptionalActor).mockResolvedValue(
      actor('alex-id', 'Alex Tester', 'alex@adiutor.test'),
    );
    await renderStep({ token: 'abc' });

    expect(screen.getByRole('status')).toHaveTextContent(
      "You're signed in as Alex Tester (alex@adiutor.test) in this browser.",
    );
  });

  it("goes on without the link when it's for the account that's signed in", async () => {
    vi.mocked(getEmailLinkPreview).mockResolvedValue(JANE);
    vi.mocked(getOptionalActor).mockResolvedValue(
      actor('jane-id', 'Jane Tester', 'jane@adiutor.test'),
    );
    await renderStep({ token: 'abc' });

    expect(screen.getByRole('heading', { name: "You're already signed in" })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue signing in' })).not.toBeInTheDocument();
  });
});
