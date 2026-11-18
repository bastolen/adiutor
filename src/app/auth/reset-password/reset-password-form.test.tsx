/**
 * @file Tests for the reset-password form: it saves a new password with the
 * link's token, refuses passwords that differ, and starts over when its page
 * is hidden, so the next person on the browser finds neither the passwords
 * nor the confirmation.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Page from '../../../../tests/ui/page';
import ResetPasswordForm from './reset-password-form';

/** Mocked Better Auth client method. */
const { resetPassword } = vi.hoisted(() => ({ resetPassword: vi.fn() }));

/** Query string the mocked `useSearchParams` returns. */
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  /**
   * Mocked query string.
   *
   * @returns The current test's `searchParams`.
   */
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/sign-in/auth-client', () => ({ default: { resetPassword } }));

/** A password long enough to be accepted. */
const PASSWORD = 'a long passphrase for tests';

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams({ token: 'reset-token' });
  });

  it('saves the new password with the link’s token and says so', async () => {
    const user = userEvent.setup();
    resetPassword.mockResolvedValue({ data: { status: true }, error: null });
    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(resetPassword).toHaveBeenCalledWith({ newPassword: PASSWORD, token: 'reset-token' });
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth');
  });

  it('refuses passwords that differ, keeping what was typed', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), `${PASSWORD}!`);
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("The passwords don't match.");
    expect(resetPassword).not.toHaveBeenCalled();
    expect(screen.getByLabelText('New password')).toHaveValue(PASSWORD);
  });

  it('has forgotten both passwords when the page is shown again', async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <ResetPasswordForm />
      </Page>,
    );

    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });

  it('has forgotten the confirmation when the page is shown again', async () => {
    const user = userEvent.setup();
    resetPassword.mockResolvedValue({ data: { status: true }, error: null });
    render(
      <Page>
        <ResetPasswordForm />
      </Page>,
    );

    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(screen.queryByRole('heading', { name: 'Password changed' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });

  it('is not still busy when the page is shown again', async () => {
    const user = userEvent.setup();
    // A request that never answers, as when the page is left while it runs.
    resetPassword.mockReturnValue(new Promise(() => {}));
    render(
      <Page>
        <ResetPasswordForm />
      </Page>,
    );

    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(screen.getByRole('button', { name: 'Save password' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(screen.getByRole('button', { name: 'Save password' })).not.toHaveAttribute('aria-busy');
  });
});
