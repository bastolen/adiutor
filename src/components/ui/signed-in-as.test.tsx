/**
 * @file Tests for turning off changes on screen while a staff member is
 * signed in as the user: the hook follows the banner's marker, and the
 * shared controls (`RowAction`, `ActionDialog`) render disabled meanwhile,
 * except the user's own work, and so does everything in a form's
 * `ChangesFieldset`, its fields included. The marker also keeps the banner's
 * height on `<html>`, for the page's scroll padding.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import ActionDialog from './action-dialog';
import RowAction from './row-action';
import {
  BANNER_HEIGHT_VARIABLE,
  ChangesFieldset,
  SignedInAsMarker,
  useSignedInAs,
} from './signed-in-as';
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

describe('SignedInAsMarker', () => {
  /**
   * The banner's height as the page knows it.
   *
   * @returns The variable's value on `<html>`, or `''` when it isn't set.
   */
  const noted = () => document.documentElement.style.getPropertyValue(BANNER_HEIGHT_VARIABLE);

  /**
   * Makes every element as tall as given, since the test DOM lays nothing out.
   *
   * @param height - The height, in pixels.
   */
  const layOut = (height: number) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 343, height),
    );
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('notes the height of the banner it is in on <html>, and forgets it when the banner goes', () => {
    layOut(75.5);
    const { unmount } = render(
      <section>
        <SignedInAsMarker />
      </section>,
    );

    // Rounded up: nothing may peek out from under the banner.
    expect(noted()).toBe('76px');

    unmount();
    expect(noted()).toBe('');
  });

  it('follows the banner as its size changes, until it goes', () => {
    /** The size observers made, with what they watch. */
    const observers: { resized: () => void; watched: Element[]; stopped: boolean }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        /** What the test reads and drives. */
        private readonly record: (typeof observers)[number];

        /**
         * Records the observer.
         *
         * @param callback - Called when a watched element's size changes.
         */
        constructor(callback: () => void) {
          this.record = { resized: callback, watched: [], stopped: false };
          observers.push(this.record);
        }

        /**
         * Starts watching an element.
         *
         * @param element - The element.
         */
        observe(element: Element) {
          this.record.watched.push(element);
        }

        /** Stops watching. */
        disconnect() {
          this.record.stopped = true;
        }
      },
    );
    layOut(76);
    const { unmount } = render(
      <section aria-label="Signed in as someone else">
        <SignedInAsMarker />
      </section>,
    );
    const observer = defined(observers[0], 'the size observer');
    expect(observer.watched).toEqual([
      screen.getByRole('region', { name: 'Signed in as someone else' }),
    ]);
    expect(noted()).toBe('76px');

    // On a narrower screen the banner's text wraps onto more lines.
    layOut(120);
    act(() => observer.resized());
    expect(noted()).toBe('120px');

    unmount();
    expect(observer.stopped).toBe(true);
    expect(noted()).toBe('');
  });

  it('shows nothing itself', () => {
    render(
      <section aria-label="Signed in as someone else">
        <SignedInAsMarker />
      </section>,
    );

    const banner = screen.getByRole('region', { name: 'Signed in as someone else' });
    expect(banner).toHaveTextContent('');
    expect(banner.firstElementChild).not.toBeVisible();
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
