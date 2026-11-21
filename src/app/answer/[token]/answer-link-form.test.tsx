/**
 * @file Tests for the button on an answer link's page: one button for the
 * answer the email's button stood for, or Approve and Deny; a press sends the
 * token with its answer, and a refusal is said inline.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import AnswerLinkForm from './answer-link-form';

/** The mocked server action. */
const { answerLinkAction } = vi.hoisted(() => ({ answerLinkAction: vi.fn() }));

vi.mock('./actions', () => ({ answerLinkAction }));

describe('AnswerLinkForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers only the answer the email’s button stood for', () => {
    render(<AnswerLinkForm token="link-token" answers={['deny']} />);

    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('sends the token with the pressed answer', async () => {
    const user = userEvent.setup();
    answerLinkAction.mockResolvedValue({ ok: true });
    render(<AnswerLinkForm token="link-token" answers={['approve', 'deny']} />);

    await user.click(screen.getByRole('button', { name: 'Deny' }));

    await vi.waitFor(() => expect(answerLinkAction).toHaveBeenCalled());
    const formData = defined(answerLinkAction.mock.calls[0], 'the first call')[1] as FormData;
    expect(Object.fromEntries(formData)).toEqual({ token: 'link-token', answer: 'deny' });
  });

  it('says why it couldn’t answer, and keeps the buttons', async () => {
    const user = userEvent.setup();
    answerLinkAction.mockResolvedValue({ ok: false, message: 'Too many attempts.' });
    render(<AnswerLinkForm token="link-token" answers={['approve']} />);

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Too many attempts.');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});
