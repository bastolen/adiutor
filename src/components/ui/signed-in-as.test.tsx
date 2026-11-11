/**
 * @file Tests for turning off changes on screen while a staff member is
 * signed in as the user: the hook follows the banner's marker, and the
 * shared controls (`RowAction`, `ActionDialog`) render disabled meanwhile,
 * except the user's own work, and so does everything in a form's
 * `ChangesFieldset`, its fields included.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ActionDialog from './action-dialog';
import RowAction from './row-action';
import { ChangesFieldset, SignedInAsMarker, useSignedInAs } from './signed-in-as';
import TextField from './text-field';

vi.mock('next/navigation', () => ({
  /**
   * Mocked router, for the confirmation step of the dialog.
   *
   * @returns The router.
   */
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/**
 * Says whether changes are turned off, as text to check.
 *
 * @returns The state.
 */
function State() {
  return <p>{useSignedInAs() ? 'off' : 'on'}</p>;
}

/**
 * The controls to check: an ordinary action, the user's own work, and a dialog.
 *
 * @returns The controls.
 */
function Controls() {
  const action = vi.fn();
  return (
    <>
      <RowAction action={action} label="Remove" />
      <RowAction action={action} label="Hide tip" allowedWhileSignedInAs />
      <ActionDialog
        action={action}
        triggerLabel="Rename"
        title="Rename?"
        description="It changes the name."
        confirmLabel="Rename"
      />
    </>
  );
}

describe('useSignedInAs', () => {
  it('is on only while the banner’s marker is mounted', () => {
    const { rerender } = render(<State />);
    expect(screen.getByText('on')).toBeInTheDocument();

    rerender(
      <>
        <State />
        <SignedInAsMarker />
      </>,
    );
    expect(screen.getByText('off')).toBeInTheDocument();

    rerender(<State />);
    expect(screen.getByText('on')).toBeInTheDocument();
  });
});

describe('the shared controls while signed in as someone', () => {
  it('render disabled, except the user’s own work', () => {
    render(
      <>
        <Controls />
        <SignedInAsMarker />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hide tip' })).toBeEnabled();
  });

  it('stay enabled otherwise', () => {
    render(<Controls />);

    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled();
  });
});

describe('ChangesFieldset', () => {
  /**
   * A form with a field and its submit button, in the fieldset.
   *
   * @returns The form.
   */
  function NameForm() {
    return (
      <form>
        <ChangesFieldset>
          <TextField name="name" label="Name" defaultValue="Jane Doe" />
          <button type="submit">Save name</button>
        </ChangesFieldset>
      </form>
    );
  }

  it('turns off the field and the button while signed in as someone', () => {
    render(
      <>
        <NameForm />
        <SignedInAsMarker />
      </>,
    );

    expect(screen.getByRole('textbox', { name: 'Name' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();
  });

  it('leaves the form as it is otherwise, and adds no group', () => {
    render(<NameForm />);

    expect(screen.getByRole('textbox', { name: 'Name' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save name' })).toBeEnabled();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
