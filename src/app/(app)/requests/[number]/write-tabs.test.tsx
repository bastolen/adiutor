/**
 * @file Tests for the tabs the staff write a reply or an internal note on.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import WriteTabs from './write-tabs';

vi.mock('./actions', () => ({ replyAction: vi.fn(), noteAction: vi.fn() }));
vi.mock('../../_requests/mention-actions', () => ({ mentionChoicesAction: vi.fn() }));

describe('WriteTabs', () => {
  it('opens on the reply, with the note on a tab of its own and its own draft', async () => {
    const user = userEvent.setup();
    render(<WriteTabs request={142} canWait />);

    expect(screen.getByRole('tab', { name: 'Reply' })).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('button', { name: 'Send and wait for the company' }),
    ).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Your reply' }), 'For the company.');

    await user.click(screen.getByRole('tab', { name: 'Internal note' }));
    const note = screen.getByRole('textbox', { name: 'Your note' });
    expect(note).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your reply', hidden: true })).toHaveValue(
      'For the company.',
    );
  });
});
