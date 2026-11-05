/**
 * @file Tests for the state hooks that reset when the page is hidden.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Activity, type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import { useTransientActionState, useTransientState } from './use-transient-state';

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

/**
 * A message set by a button, kept in {@link useTransientState}.
 *
 * @returns The component.
 */
function Notice() {
  const [message, setMessage] = useTransientState<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => setMessage('Passkey added.')}>
        Add
      </button>
      {message && <p role="status">{message}</p>}
    </>
  );
}

/**
 * A form whose action saves the typed name, with {@link useTransientActionState}.
 *
 * @returns The component.
 */
function NameForm() {
  const [result, formAction] = useTransientActionState(
    async (_previous: { message: string } | null, formData: FormData) => ({
      message: `Saved ${String(formData.get('name'))}.`,
    }),
    null,
  );
  return (
    <form action={formAction}>
      <label htmlFor="name">
        Name
        <input id="name" name="name" defaultValue="Adiutor" />
      </label>
      <button type="submit">Save</button>
      {result && <p role="status">{result.message}</p>}
    </form>
  );
}

/** What the test form's action answers. */
type Outcome = { ok: true; message: string } | { ok: false; message: string };

/**
 * A form with a name field and two submit buttons, submitted through the
 * hook's `onSubmit`, whose action answers with the given outcome.
 *
 * @param props - Component props.
 * @param props.answer - Builds the action's answer from the submitted data.
 * @param props.resetOnSuccess - Passed to the hook.
 * @returns The component.
 */
function OutcomeForm({
  answer,
  resetOnSuccess = true,
}: {
  answer: (formData: FormData) => Outcome | Promise<Outcome>;
  resetOnSuccess?: boolean;
}) {
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    async (_previous: Outcome | null, formData: FormData) => answer(formData),
    null,
    { resetOnSuccess },
  );
  return (
    <form action={formAction} onSubmit={onSubmit}>
      <label htmlFor="outcome-name">
        Name
        <input id="outcome-name" name="name" defaultValue="" />
      </label>
      <button type="submit" name="intent" value="save" aria-busy={pending}>
        Save
      </button>
      <button type="submit" name="intent" value="publish">
        Publish
      </button>
      {result && <p role="status">{result.message}</p>}
    </form>
  );
}

describe('useTransientState', () => {
  it('resets when the page is hidden', async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <Notice />
      </Page>,
    );

    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('status')).toHaveTextContent('Passkey added.');

    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('useTransientActionState', () => {
  it('hides the last result after the page was hidden, and shows the next one', async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <NameForm />
      </Page>,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved Adiutor.');

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Adiutor Support');
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // What was typed stays.
    expect(screen.getByLabelText('Name')).toHaveValue('Adiutor Support');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved Adiutor Support.');
  });
  it('keeps what was typed when the action refuses it', async () => {
    const user = userEvent.setup();
    render(<OutcomeForm answer={() => ({ ok: false, message: 'That name is taken.' })} />);

    await user.type(screen.getByLabelText('Name'), 'Adiutor Tests');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('That name is taken.');
    expect(screen.getByLabelText('Name')).toHaveValue('Adiutor Tests');
  });

  it('clears the form after a successful result, unless asked not to', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OutcomeForm answer={() => ({ ok: true, message: 'Saved.' })} />);

    await user.type(screen.getByLabelText('Name'), 'Adiutor Tests');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(screen.getByLabelText('Name')).toHaveValue('');
    unmount();

    render(<OutcomeForm answer={() => ({ ok: true, message: 'Saved.' })} resetOnSuccess={false} />);
    await user.type(screen.getByLabelText('Name'), 'Adiutor Tests');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(screen.getByLabelText('Name')).toHaveValue('Adiutor Tests');
  });

  it('sends the button that submitted the form, and is busy while the action runs', async () => {
    const user = userEvent.setup();
    /** Settles the action, which the test holds back while it checks the busy state. */
    let finish: (outcome: Outcome) => void = () => {};
    const answer = vi.fn(
      (_formData: FormData) =>
        new Promise<Outcome>((resolve) => {
          finish = resolve;
        }),
    );
    render(<OutcomeForm answer={answer} />);

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(defined(answer.mock.calls[0], 'the first call')[0].get('intent')).toBe('publish');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true');

    await act(async () => finish({ ok: false, message: 'Not yet.' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Not yet.');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'false');
  });
});
