/**
 * @file Tests for how the reader reads a request's activity on its page: the
 * "Show" menu (the groups each reader is offered, ticking and unticking, the
 * internal notes ticked along with Replies, back to everything), the order
 * menu, the busy state, the error of a failed save, the controls being off
 * while signed in as the reader, and the "Show everything" button.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import restoreFocusIfLost from '@/components/ui/focus-fallback';
import { SignedInAsMarker } from '@/components/ui/signed-in-as';
import type { ActivityGroup, ActivityView } from '@/lib/requests';

import { saveActivityViewAction } from './actions';
import {
  ActivityControls,
  ActivityError,
  ActivityViewProvider,
  ShowEverythingButton,
} from './activity-view';

vi.mock('./actions', () => ({ saveActivityViewAction: vi.fn() }));
vi.mock('@/components/ui/focus-fallback', () => ({ default: vi.fn() }));

/**
 * Settles the saves a test held back ({@link holdSaves}). React keeps every
 * later async transition pending while one is, so none may outlive its test.
 */
const settleHeld: (() => void)[] = [];

afterEach(() => {
  settleHeld.splice(0).forEach((settle) => {
    settle();
  });
  vi.mocked(saveActivityViewAction).mockReset();
  vi.mocked(restoreFocusIfLost).mockReset();
});

/** What the staff are offered. */
const STAFF: ActivityGroup[] = ['replies', 'notes', 'status', 'changes'];
/** What someone at the company is offered. */
const COMPANY: ActivityGroup[] = ['replies', 'status', 'changes'];
/** Everything, oldest first. */
const EVERYTHING: ActivityView = { order: 'oldest', groups: null };

/**
 * Renders the menus and the error as the page does.
 *
 * @param view - The saved view.
 * @param offered - The groups the reader is offered.
 * @returns The render result.
 */
function renderControls(view: ActivityView = EVERYTHING, offered: ActivityGroup[] = STAFF) {
  vi.mocked(saveActivityViewAction).mockResolvedValue({ ok: true });
  return render(
    <ActivityViewProvider view={view} offered={offered}>
      <ActivityControls />
      <ActivityError />
    </ActivityViewProvider>,
  );
}

/**
 * Holds back every save until the test settles it (or the test ends), as
 * the page's refresh would: the menus show the choice while it's saved.
 *
 * @returns Settles the saves held back.
 */
function holdSaves(): () => void {
  /** Settles each save held back. */
  const held: ((result: { ok: true }) => void)[] = [];
  vi.mocked(saveActivityViewAction).mockImplementation(
    () =>
      new Promise((resolve) => {
        held.push(resolve);
      }),
  );
  /** Settles every save held back so far, as each one worked. */
  const settle = () => {
    held.splice(0).forEach((finish) => {
      finish({ ok: true });
    });
  };
  settleHeld.push(settle);
  return settle;
}

describe('The Show menu', () => {
  it('offers the staff every group, Replies with the notes, and the notes ticked along', async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole('button', { name: 'Show: Everything' }));

    expect(screen.getByRole('menuitemcheckbox', { name: 'Everything' })).toBeChecked();
    const replies = screen.getByRole('menuitemcheckbox', { name: 'Replies' });
    expect(replies).toBeChecked();
    expect(replies).toHaveAccessibleDescription('With internal notes');
    const notes = screen.getByRole('menuitemcheckbox', { name: 'Internal notes' });
    expect(notes).toBeChecked();
    expect(notes).toHaveAttribute('aria-disabled', 'true');
    expect(notes).toHaveAccessibleDescription('Included in Replies');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Status changes' })).toBeChecked();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Other changes' })).toBeChecked();
  });

  it('never offers someone at the company the internal notes', async () => {
    const user = userEvent.setup();
    renderControls(EVERYTHING, COMPANY);

    await user.click(screen.getByRole('button', { name: 'Show: Everything' }));

    expect(screen.getAllByRole('menuitemcheckbox').map((item) => item.textContent)).toEqual([
      'Everything',
      'Replies',
      'Status changes',
      'Other changes',
    ]);
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Replies' }),
    ).not.toHaveAccessibleDescription();
  });

  it('saves a group unticked, keeps the menu open and shows the choice at once', async () => {
    const user = userEvent.setup();
    renderControls();
    holdSaves();

    await user.click(screen.getByRole('button', { name: 'Show: Everything' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Replies' }));

    expect(saveActivityViewAction).toHaveBeenCalledWith({
      groups: ['notes', 'status', 'changes'],
    });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // Behind the open menu, which hides the rest of the page from screen readers.
    expect(
      screen.getByRole('button', {
        name: 'Show: Internal notes, Status changes, and Other changes',
        hidden: true,
      }),
    ).toBeInTheDocument();
    // The notes are a choice of their own now.
    const notes = screen.getByRole('menuitemcheckbox', { name: 'Internal notes' });
    expect(notes).toBeChecked();
    expect(notes).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Everything' })).not.toBeChecked();
  });

  it('changes nothing when the notes are pressed while Replies holds them', async () => {
    const user = userEvent.setup();
    renderControls({ order: 'oldest', groups: ['replies'] });

    await user.click(screen.getByRole('button', { name: 'Show: Replies' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Internal notes' }));

    expect(saveActivityViewAction).not.toHaveBeenCalled();
  });

  it('shows everything again when the last group is unticked, or Everything is ticked', async () => {
    const user = userEvent.setup();
    renderControls({ order: 'oldest', groups: ['status'] });

    await user.click(screen.getByRole('button', { name: 'Show: Status changes' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Status changes' }));
    expect(saveActivityViewAction).toHaveBeenLastCalledWith({ groups: null });

    await waitFor(() => expect(saveActivityViewAction).toHaveBeenCalledTimes(1));
  });

  it('ticks Everything from a choice', async () => {
    const user = userEvent.setup();
    renderControls({ order: 'oldest', groups: ['replies', 'changes'] });

    await user.click(screen.getByRole('button', { name: 'Show: Replies and Other changes' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Everything' }));

    expect(saveActivityViewAction).toHaveBeenCalledWith({ groups: null });
  });

  it('is busy while a choice is saved, and stays focusable', async () => {
    const user = userEvent.setup();
    renderControls();
    const finish = holdSaves();
    const trigger = screen.getByRole('button', { name: 'Show: Everything' });

    trigger.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Replies' })).toHaveFocus();
    await user.keyboard(' ');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Show:/, hidden: true })).toHaveAttribute(
        'aria-busy',
        'true',
      ),
    );
    expect(saveActivityViewAction).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /^Show:/ })).toHaveFocus();

    finish();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Show:/ })).not.toHaveAttribute('aria-busy'),
    );
  });

  it('says why a save failed, and shows the saved choice again', async () => {
    const user = userEvent.setup();
    renderControls();
    vi.mocked(saveActivityViewAction).mockResolvedValue({
      ok: false,
      message: 'Something went wrong. Try again.',
    });

    await user.click(screen.getByRole('button', { name: 'Show: Everything' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Status changes' }));
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(screen.getByRole('button', { name: 'Show: Everything' })).toBeInTheDocument();
  });
});

describe('The order menu', () => {
  it('saves the order chosen, closes and gives focus back to its button', async () => {
    const user = userEvent.setup();
    renderControls();
    holdSaves();
    const trigger = screen.getByRole('button', { name: 'Oldest first' });

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitemradio', { name: 'Oldest first' })).toBeChecked();
    await user.keyboard('{ArrowDown}{Enter}');

    expect(saveActivityViewAction).toHaveBeenCalledWith({ order: 'newest' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const newest = screen.getByRole('button', { name: 'Newest first' });
    expect(newest).toBe(trigger);
    expect(newest).toHaveFocus();
  });

  it('saves nothing when the order it has is chosen again', async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole('button', { name: 'Oldest first' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Oldest first' }));

    expect(saveActivityViewAction).not.toHaveBeenCalled();
  });
});

describe('ActivityControls while signed in as the reader', () => {
  it('turns both menus off', () => {
    render(
      <ActivityViewProvider view={EVERYTHING} offered={STAFF}>
        <ActivityControls />
        <SignedInAsMarker />
      </ActivityViewProvider>,
    );

    expect(screen.getByRole('button', { name: 'Show: Everything' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Oldest first' })).toBeDisabled();
  });
});

describe('ShowEverythingButton', () => {
  it('shows everything, and keeps focus from falling to the page once it is gone', async () => {
    vi.mocked(saveActivityViewAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const view: ActivityView = { order: 'oldest', groups: ['status'] };
    const { rerender } = render(
      <ActivityViewProvider view={view} offered={STAFF}>
        <ShowEverythingButton>Show everything</ShowEverythingButton>
      </ActivityViewProvider>,
    );
    const button = screen.getByRole('button', { name: 'Show everything' });

    await user.click(button);
    expect(saveActivityViewAction).toHaveBeenCalledWith({ groups: null });

    rerender(
      <ActivityViewProvider view={EVERYTHING} offered={STAFF}>
        {null}
      </ActivityViewProvider>,
    );
    expect(restoreFocusIfLost).toHaveBeenCalledWith(button);
  });
});
