/**
 * @file Tests for the "Emails about requests" card on the Preferences tab: it
 * says whether the user gets them and offers the switch the other way.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import RequestEmailsCard from './request-emails-card';

/** Mocked server action. */
const { requestEmailsAction } = vi.hoisted(() => ({
  requestEmailsAction: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../actions', () => ({ requestEmailsAction }));

describe('RequestEmailsCard', () => {
  it('says they are on, what they are, and turns them off', async () => {
    const user = userEvent.setup();
    const { container } = render(<RequestEmailsCard on />);

    expect(screen.getByRole('heading', { name: 'Emails about requests' })).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText(/also for requests assigned to you/)).toBeInTheDocument();
    // The emails' footers link to this card.
    expect(container.querySelector('#request-emails')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Turn off' }));

    const formData = defined(requestEmailsAction.mock.calls[0], 'the first call')[1] as FormData;
    expect(formData.get('on')).toBe('false');
  });

  it('says they are off, and turns them back on', () => {
    render(<RequestEmailsCard on={false} />);

    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });
});
