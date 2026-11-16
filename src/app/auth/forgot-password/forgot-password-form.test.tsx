/**
 * @file Tests for the forgot-password form: it asks for a reset link, says
 * the same whoever the address belongs to, and starts over when its page is
 * hidden, so the next person on the browser doesn't find the last address.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Activity, type ReactNode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ForgotPasswordForm from './forgot-password-form';

/** Mocked Better Auth client method. */
const { requestPasswordReset } = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));

vi.mock('@/lib/sign-in/auth-client', () => ({ default: { requestPasswordReset } }));

/**
 * Wraps content in an `<Activity>` that a "Leave" / "Return" button hides and
 * shows, like Next.js does with a page when you navigate away and back.
 *
 * @param props - Harness props.
 * @param props.children - The page content.
 * @returns The harness.
 */
function Page({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setVisible((value) => !value)}>
        {visible ? 'Leave' : 'Return'}
      </button>
      <Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity>
    </>
  );
}

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for a reset link and confirms without saying whether the account exists', async () => {
    const user = userEvent.setup();
    requestPasswordReset.mockResolvedValue({ data: { status: true }, error: null });
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText('Email'), 'jane@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(requestPasswordReset).toHaveBeenCalledWith({
      email: 'jane@adiutor.test',
      redirectTo: '/auth/reset-password',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'If jane@adiutor.test has an account, a reset link is on its way. Check your inbox.',
    );
  });

  it('says why sending failed and keeps the address', async () => {
    const user = userEvent.setup();
    requestPasswordReset.mockResolvedValue({ data: null, error: { status: 500 } });
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText('Email'), 'jane@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sending the link failed. Please try again.',
    );
    expect(screen.getByLabelText('Email')).toHaveValue('jane@adiutor.test');
  });

  it('has forgotten the address when the page is shown again', async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <ForgotPasswordForm />
      </Page>,
    );

    await user.type(screen.getByLabelText('Email'), 'jane@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(screen.getByLabelText('Email')).toHaveValue('');
  });

  it('has forgotten the confirmation and its address when the page is shown again', async () => {
    const user = userEvent.setup();
    requestPasswordReset.mockResolvedValue({ data: { status: true }, error: null });
    render(
      <Page>
        <ForgotPasswordForm />
      </Page>,
    );

    await user.type(screen.getByLabelText('Email'), 'jane@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('jane@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/jane@adiutor\.test/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('');
  });

  it('is not still busy when the page is shown again', async () => {
    const user = userEvent.setup();
    // A request that never answers, as when the page is left while it runs.
    requestPasswordReset.mockReturnValue(new Promise(() => {}));
    render(
      <Page>
        <ForgotPasswordForm />
      </Page>,
    );

    await user.type(screen.getByLabelText('Email'), 'jane@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(screen.getByRole('button', { name: 'Send reset link' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(screen.getByRole('button', { name: 'Send reset link' })).not.toHaveAttribute(
      'aria-busy',
    );
  });
});
