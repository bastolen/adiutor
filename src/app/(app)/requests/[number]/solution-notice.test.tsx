/**
 * @file Tests for the notice that asks the company to approve or deny the
 * solution the staff sent.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import renderInLocale from '../../../../../tests/i18n/render';
import { answerSolutionAction } from './actions';
import SolutionNotice from './solution-notice';

vi.mock('./actions', () => ({ answerSolutionAction: vi.fn() }));

afterEach(() => {
  vi.mocked(answerSolutionAction).mockReset();
});

describe('SolutionNotice', () => {
  it('asks whether the solution solves the request, under a heading of its own', () => {
    renderInLocale('en-US', <SolutionNotice request={142} />);

    expect(
      screen.getByRole('region', { name: 'The staff proposed a solution' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Does it solve your request\?/)).toBeInTheDocument();
  });

  it('approves it in one click', async () => {
    vi.mocked(answerSolutionAction).mockResolvedValue({
      ok: true,
      message: 'You approved the solution. The request is done.',
    });
    const user = userEvent.setup();
    renderInLocale('en-US', <SolutionNotice request={142} />);

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(answerSolutionAction).toHaveBeenCalledTimes(1));
    const formData = defined(vi.mocked(answerSolutionAction).mock.calls[0], 'the call')[1];
    expect(Object.fromEntries(formData)).toEqual({ request: '142', answer: 'approve' });
  });

  it('denies it from a dialog that asks what’s still wrong, without needing an answer', async () => {
    const user = userEvent.setup();
    renderInLocale('en-US', <SolutionNotice request={142} />);

    await user.click(screen.getByRole('button', { name: 'Deny' }));

    const dialog = screen.getByRole('dialog', { name: 'Doesn’t it solve your request?' });
    expect(dialog).toHaveTextContent('The request goes back to the staff.');
    expect(screen.getByRole('textbox', { name: 'What’s still wrong?' })).not.toBeRequired();
    expect(screen.getByRole('button', { name: 'Deny solution' })).toBeInTheDocument();
  });

  it('reads in the reader’s language', () => {
    renderInLocale('nl-NL', <SolutionNotice request={142} />);

    expect(screen.getByRole('button', { name: 'Goedkeuren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Afwijzen' })).toBeInTheDocument();
  });
});
