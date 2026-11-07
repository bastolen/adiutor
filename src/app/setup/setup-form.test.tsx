/**
 * @file Tests for the first-run setup form.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import SetupForm from './setup-form';

/** Mocked server action. */
const { setupAction } = vi.hoisted(() => ({ setupAction: vi.fn() }));

vi.mock('./actions', () => ({ default: setupAction }));

/**
 * Fills in the form with test data and submits it.
 */
function submitForm() {
  fireEvent.change(screen.getByLabelText('Name shown to users'), {
    target: { value: 'Adiutor Tests' },
  });
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Setup Admin' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'setup@adiutor.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'setup-password-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set up Adiutor' }));
}

describe('SetupForm', () => {
  beforeEach(() => {
    setupAction.mockReset();
  });

  it('submits the staff name and the first Admin', async () => {
    setupAction.mockResolvedValue({ ok: true });
    render(<SetupForm />);
    submitForm();

    await waitFor(() => expect(setupAction).toHaveBeenCalledTimes(1));
    expect(
      Object.fromEntries(defined(setupAction.mock.calls[0], 'the first call')[1] as FormData),
    ).toEqual({
      staffName: 'Adiutor Tests',
      name: 'Setup Admin',
      email: 'setup@adiutor.test',
      password: 'setup-password-1',
    });
  });

  it('shows why setup failed', async () => {
    setupAction.mockResolvedValue({
      ok: false,
      message: 'Adiutor is already set up. Sign in instead.',
    });
    render(<SetupForm />);
    submitForm();

    expect(await screen.findByRole('alert')).toHaveTextContent('already set up');
  });
});
