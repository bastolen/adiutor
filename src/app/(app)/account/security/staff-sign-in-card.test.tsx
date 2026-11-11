/**
 * @file Tests for the "Sign-ins by staff" card on the Security page: it says
 * whether staff may sign in as the user and offers the switch the other way.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import StaffSignInCard from './staff-sign-in-card';

/** Mocked server action. */
const { staffSignInAction } = vi.hoisted(() => ({
  staffSignInAction: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('./actions', () => ({ staffSignInAction }));

describe('StaffSignInCard', () => {
  it('says it is on, what it means, and turns it off', async () => {
    const user = userEvent.setup();
    render(<StaffSignInCard allowed />);

    expect(screen.getByRole('heading', { name: 'Sign-ins by staff' })).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText(/sign in as you for up to 30 minutes/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Turn off' }));

    const formData = defined(staffSignInAction.mock.calls[0], 'the first call')[1] as FormData;
    expect(formData.get('allowed')).toBe('false');
  });

  it('says it is off, and turns it back on', () => {
    render(<StaffSignInCard allowed={false} />);

    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });
});
