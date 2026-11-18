/**
 * @file Tests for the invite link's form: joining as the signed-in user or
 * claiming the link with an email address, and where keyboard focus goes
 * when the confirmation takes the form's place.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import JoinForm from './join-form';

/** Mocked server actions. */
const { claimAction, joinAction } = vi.hoisted(() => ({
  claimAction: vi.fn(),
  joinAction: vi.fn(),
}));

vi.mock('./actions', () => ({ claimAction, joinAction }));

/** What the page says once the invitation is on its way. */
const SENT =
  "Check your inbox: we've sent an email to jane@adiutor.test. Open the link in it to continue.";

describe('JoinForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks someone who is signed out for their email address and sends it with the token', async () => {
    const user = userEvent.setup();
    claimAction.mockResolvedValue({ ok: true, message: SENT });
    render(<JoinForm token="link-token" signedInEmail={null} />);

    await user.type(screen.getByLabelText('Email'), 'jane@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByRole('status');
    const formData = defined(claimAction.mock.calls[0], 'the first call')[1] as FormData;
    expect(Object.fromEntries(formData)).toEqual({
      token: 'link-token',
      email: 'jane@adiutor.test',
    });
    expect(joinAction).not.toHaveBeenCalled();
  });

  it('moves focus to the confirmation that takes the form’s place', async () => {
    const user = userEvent.setup();
    claimAction.mockResolvedValue({ ok: true, message: SENT });
    render(<JoinForm token="link-token" signedInEmail={null} />);

    await user.type(screen.getByLabelText('Email'), 'jane@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const confirmation = await screen.findByRole('status');
    expect(confirmation).toHaveTextContent(SENT);
    // The form and its button are gone: focus is on the confirmation, not on <body>.
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(confirmation).toHaveFocus();
  });

  it('says why a link can’t be used, keeping the form and the address', async () => {
    const user = userEvent.setup();
    claimAction.mockResolvedValue({
      ok: false,
      message: 'This link can no longer be used. Ask for a new one.',
    });
    render(<JoinForm token="link-token" signedInEmail={null} />);

    await user.type(screen.getByLabelText('Email'), 'jane@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('This link can no longer be used. Ask for a new one.');
    expect(error).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveValue('jane@adiutor.test');
  });

  it('offers someone who is signed in to join as their account', async () => {
    const user = userEvent.setup();
    joinAction.mockResolvedValue({
      ok: false,
      message: 'This link can no longer be used. Ask for a new one.',
    });
    render(<JoinForm token="link-token" signedInEmail="jane@adiutor.test" />);

    expect(screen.getByText(/You'll join as/)).toHaveTextContent(
      "You'll join as jane@adiutor.test.",
    );
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Join' }));

    expect(await screen.findByRole('alert')).toHaveFocus();
    const formData = defined(joinAction.mock.calls[0], 'the first call')[1] as FormData;
    expect(Object.fromEntries(formData)).toEqual({ token: 'link-token' });
    expect(claimAction).not.toHaveBeenCalled();
  });
});
