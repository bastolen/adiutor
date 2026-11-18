/**
 * @file Tests for the state hooks that reset when the page is hidden, and
 * for what a page does once per visit.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import Page from '../../../tests/ui/page';
import { useOncePerVisit, useTransientActionState, useTransientState } from './use-transient-state';

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
 * Does something once per visit of its page, as a form emails a code when it
 * opens, with {@link useOncePerVisit}. A button changes what it does.
 *
 * @param props - Component props.
 * @param props.onVisit - What it does once per visit, with the name it has then.
 * @returns The button.
 */
function OncePerVisit({ onVisit }: { onVisit: (name: string) => void }) {
  const [name, setName] = useState('first');
  useOncePerVisit(() => onVisit(name));
  return (
    <button type="button" onClick={() => setName('second')}>
      Rename
    </button>
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

describe('useOncePerVisit', () => {
  it('runs when the page opens, and again each time it is shown again', async () => {
    const user = userEvent.setup();
    const onVisit = vi.fn();
    render(
      <Page>
        <OncePerVisit onVisit={onVisit} />
      </Page>,
    );
    expect(onVisit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(onVisit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Return' }));
    expect(onVisit).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));
    expect(onVisit).toHaveBeenCalledTimes(3);
  });

  it('runs once while Strict Mode runs the effects a second time, on mount and on return', async () => {
    const user = userEvent.setup();
    const onVisit = vi.fn();
    render(
      <StrictMode>
        <Page>
          <OncePerVisit onVisit={onVisit} />
        </Page>
      </StrictMode>,
    );
    // Not twice: Strict Mode cleaned the effects up and set them up again, but the page never went.
    expect(onVisit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));
    expect(onVisit).toHaveBeenCalledTimes(2);
  });

  it('runs what the page gave it last, without running again when that changes', async () => {
    const user = userEvent.setup();
    const onVisit = vi.fn();
    render(
      <Page>
        <OncePerVisit onVisit={onVisit} />
      </Page>,
    );

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onVisit.mock.calls).toEqual([['first']]);

    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));
    expect(onVisit.mock.calls).toEqual([['first'], ['second']]);
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
