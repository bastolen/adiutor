/**
 * @file Tests for the Add user form: what it says after registering, and
 * what "Add another" leaves behind: a new, empty form with focus on its
 * email field, which stays (with what's typed) while the next address is
 * sent and when that one is refused.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionResult } from '@/lib/action-result';
import { defined } from '@/lib/defined';

import RegisterUserForm from './register-user-form';

/** What the action returns. */
type Result = ActionResult<{ userId: string; created: boolean }>;

/** Mocked server action. */
const { registerUserAction } = vi.hoisted(() => ({ registerUserAction: vi.fn() }));

vi.mock('./actions', () => ({ default: registerUserAction }));

/** The first user's confirmation. */
const CREATED_JANE: Result = {
  ok: true,
  message: "Account created for jane@adiutor.test. We've emailed them a link to choose a password.",
  data: { userId: 'user-jane', created: true },
};

/** A refusal, as the server words it. */
const REFUSED: Result = { ok: false, message: 'Enter a valid email address.' };

/**
 * Registers the first user and presses "Add another".
 *
 * @param user - The test's user.
 */
async function addJaneThenAnother(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  registerUserAction.mockResolvedValueOnce(CREATED_JANE);
  await user.type(screen.getByLabelText('Email'), 'jane@adiutor.test');
  await user.click(screen.getByRole('button', { name: 'Add user' }));
  await screen.findByRole('link', { name: 'Open user' });
  await user.click(screen.getByRole('button', { name: 'Add another' }));
}

describe('RegisterUserForm', () => {
  beforeEach(() => {
    registerUserAction.mockReset();
  });

  it('says the account was created, with a link to the user, and takes focus', async () => {
    const user = userEvent.setup();
    registerUserAction.mockResolvedValueOnce(CREATED_JANE);
    render(<RegisterUserForm defaultLocale="en-US" />);

    await user.type(screen.getByLabelText('Email'), 'jane@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Add user' }));

    const confirmation = await screen.findByRole('status');
    expect(confirmation).toHaveTextContent('Account created for jane@adiutor.test.');
    expect(confirmation).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Open user' })).toHaveAttribute(
      'href',
      '/admin/users/user-jane',
    );
    const formData = defined(registerUserAction.mock.calls[0], 'the first call')[1] as FormData;
    expect(formData.get('email')).toBe('jane@adiutor.test');
  });

  it('keeps the address when registering is refused', async () => {
    const user = userEvent.setup();
    registerUserAction.mockResolvedValueOnce(REFUSED);
    render(<RegisterUserForm defaultLocale="en-US" />);

    await user.type(screen.getByLabelText('Email'), 'jane@adiutor');
    await user.click(screen.getByRole('button', { name: 'Add user' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
    expect(screen.getByLabelText('Email')).toHaveValue('jane@adiutor');
  });

  it('gives an empty form with focus on its email field after "Add another"', async () => {
    const user = userEvent.setup();
    render(<RegisterUserForm defaultLocale="en-US" />);

    await addJaneThenAnother(user);

    const email = screen.getByLabelText('Email');
    expect(email).toHaveValue('');
    // The button that had focus is gone with the confirmation: focus isn't left on <body>.
    expect(email).toHaveFocus();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open user' })).not.toBeInTheDocument();
  });

  it('keeps the form and what is typed while the next address is sent', async () => {
    const user = userEvent.setup();
    render(<RegisterUserForm defaultLocale="en-US" />);
    await addJaneThenAnother(user);

    /** Answers the second request, which waits until the test says so. */
    let answer: (result: Result) => void = () => {};
    registerUserAction.mockReturnValueOnce(
      new Promise<Result>((resolve) => {
        answer = resolve;
      }),
    );
    await user.type(screen.getByLabelText('Email'), 'john@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Add user' }));

    // Meanwhile the form is still there, busy, and the first user's confirmation isn't back.
    expect(screen.getByRole('button', { name: 'Add user' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Email')).toHaveValue('john@adiutor.test');
    expect(screen.queryByRole('link', { name: 'Open user' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Account created for jane@adiutor\.test/)).not.toBeInTheDocument();

    await act(async () => {
      answer({
        ok: true,
        message:
          "Account created for john@adiutor.test. We've emailed them a link to choose a password.",
        data: { userId: 'user-john', created: true },
      });
    });

    // The new result shows, with the new user's link.
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Account created for john@adiutor.test.',
    );
    expect(screen.getByRole('link', { name: 'Open user' })).toHaveAttribute(
      'href',
      '/admin/users/user-john',
    );
  });

  it('keeps what is typed when the next address is refused', async () => {
    const user = userEvent.setup();
    render(<RegisterUserForm defaultLocale="en-US" />);
    await addJaneThenAnother(user);

    registerUserAction.mockResolvedValueOnce(REFUSED);
    await user.type(screen.getByLabelText('Email'), 'john@adiutor');
    await user.click(screen.getByRole('button', { name: 'Add user' }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Enter a valid email address.');
    expect(error).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveValue('john@adiutor');
    expect(screen.queryByRole('link', { name: 'Open user' })).not.toBeInTheDocument();
  });

  it('says so when the address already has an account', async () => {
    const user = userEvent.setup();
    registerUserAction.mockResolvedValueOnce({
      ok: true,
      message: 'jane@adiutor.test already has an account. Nothing was changed.',
      data: { userId: 'user-jane', created: false },
    } satisfies Result);
    render(<RegisterUserForm defaultLocale="en-US" />);

    await user.type(screen.getByLabelText('Email'), 'jane@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Add user' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'jane@adiutor.test already has an account. Nothing was changed.',
    );
    expect(screen.getByRole('link', { name: 'Open user' })).toHaveAttribute(
      'href',
      '/admin/users/user-jane',
    );
  });
});
