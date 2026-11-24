/**
 * @file Tests for {@link useSaveOnPick}: a picked value shows until a newer
 * result arrives, a save sends the form's fields with the picked value, and
 * forgetting the pick shows the saved value again.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ActionResult } from '@/lib/action-result';

import useSaveOnPick from './use-save-on-pick';

/**
 * A form with one hidden field that saves `color` with the hook, and
 * buttons in place of a select's options.
 *
 * @param props - Component props.
 * @param props.action - The saving action.
 * @param props.saved - The saved colour.
 * @returns The form, showing the colour the select would show.
 */
function ColorForm({
  action,
  saved,
}: {
  action: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  saved: string;
}) {
  const { formRef, formAction, onSubmit, result, shown, picked, pick, unpick, save } =
    useSaveOnPick(action, { name: 'color', saved });
  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit}>
      <input type="hidden" name="item" value="mug" />
      <output aria-label="Shown">{shown}</output>
      <output aria-label="Picked">{picked ?? 'none'}</output>
      <output aria-label="Result">{result?.message ?? 'none'}</output>
      <button type="button" onClick={() => pick('blue')}>
        Pick blue
      </button>
      <button
        type="button"
        onClick={() => {
          pick('blue');
          save('blue');
        }}
      >
        Save blue
      </button>
      <button type="button" onClick={unpick}>
        Forget
      </button>
    </form>
  );
}

describe('useSaveOnPick', () => {
  it('shows the picked value while it saves, then the saved one that comes with the result', async () => {
    // How the test answers each save, once it lets it.
    const answers: ((result: ActionResult) => void)[] = [];
    const action = vi.fn(
      (_previous: ActionResult | null, _formData: FormData) =>
        new Promise<ActionResult>((resolve) => {
          answers.push(resolve);
        }),
    );
    const user = userEvent.setup();
    const { rerender } = render(<ColorForm action={action} saved="red" />);

    await user.click(screen.getByRole('button', { name: 'Save blue' }));
    expect(screen.getByRole('status', { name: 'Shown' })).toHaveTextContent('blue');
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    const sent = action.mock.calls[0]?.[1];
    expect(sent && Object.fromEntries(sent)).toEqual({ item: 'mug', color: 'blue' });

    // The page refreshes with the new value as the result arrives.
    rerender(<ColorForm action={action} saved="blue" />);
    answers[0]?.({ ok: true, message: 'Saved.' });
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Result' })).toHaveTextContent('Saved.'),
    );
    expect(screen.getByRole('status', { name: 'Shown' })).toHaveTextContent('blue');
  });

  it('shows the saved value again after a refusal, or once the pick is forgotten', async () => {
    const action = vi.fn(async () => ({ ok: false, message: 'Refused.' }));
    const user = userEvent.setup();
    render(<ColorForm action={action} saved="red" />);

    await user.click(screen.getByRole('button', { name: 'Pick blue' }));
    expect(screen.getByRole('status', { name: 'Shown' })).toHaveTextContent('blue');
    expect(screen.getByRole('status', { name: 'Picked' })).toHaveTextContent('blue');
    await user.click(screen.getByRole('button', { name: 'Forget' }));
    expect(screen.getByRole('status', { name: 'Shown' })).toHaveTextContent('red');

    await user.click(screen.getByRole('button', { name: 'Save blue' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Result' })).toHaveTextContent('Refused.'),
    );
    expect(screen.getByRole('status', { name: 'Shown' })).toHaveTextContent('red');
  });
});
