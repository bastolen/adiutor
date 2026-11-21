/**
 * @file Tests for the browser part of the board of requests: the lanes with
 * their counts, "See all" and an empty lane, the Move menu (none on a card
 * the reader can't move), moving a card at once and saving it from the lane
 * it was in, Done and Cancelled asking first, a refusal, and where focus goes
 * after a move.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Toaster } from '@/components/ui/toast';
import type { ActionResult } from '@/lib/action-result';
import type { BoardLaneState, RequestStatus } from '@/lib/requests';

import Board from './board';
import { moveRequestAction } from './board-actions';
import type { BoardCardView } from './board-card';

vi.mock('./board-actions', () => ({ moveRequestAction: vi.fn() }));

/** Each lane's name, as the staff read it. */
const NAMES: Record<RequestStatus, string> = {
  open: 'Open',
  todo: 'To do',
  in_progress: 'In progress',
  waiting: 'Waiting for the company',
  proposed: 'Waiting for approval',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** Each lane's link to the list. */
const SEE_ALL = Object.fromEntries(
  Object.keys(NAMES).map((status) => [status, `/requests?only=${status}`]),
) as Record<RequestStatus, string>;

/**
 * A card, with its title as its content.
 *
 * @param number - The request's number.
 * @param status - Its lane.
 * @param moves - Where it may go.
 * @returns The card.
 */
function card(number: number, status: RequestStatus, moves: RequestStatus[]): BoardCardView {
  return {
    id: `request-${number}`,
    number,
    reference: `AD-${number}`,
    status,
    moves,
    body: <span>{`Request ${number}`}</span>,
    meta: null,
  };
}

/**
 * The board's lanes: two cards in Open (one of three requests), one in Done,
 * which the reader can't move, and the other lanes empty.
 *
 * @returns The lanes.
 */
function lanes(): BoardLaneState<BoardCardView>[] {
  const cards: Partial<Record<RequestStatus, { total: number; items: BoardCardView[] }>> = {
    open: {
      total: 3,
      items: [
        card(1, 'open', ['todo', 'in_progress', 'done', 'cancelled']),
        card(2, 'open', ['todo', 'in_progress', 'done', 'cancelled']),
      ],
    },
    done: { total: 1, items: [card(3, 'done', [])] },
  };
  return (Object.keys(NAMES) as RequestStatus[]).map((status) => ({
    status,
    total: cards[status]?.total ?? 0,
    items: cards[status]?.items ?? [],
  }));
}

/**
 * A lane on the screen.
 *
 * @param name - The start of its heading.
 * @returns The lane's section.
 */
const lane = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name},`) });

/**
 * The toasts on the screen.
 *
 * @returns Their region.
 */
const toasts = () => screen.getByRole('region', { name: /^Notifications/ });

/**
 * Shows the board, with a place for toasts.
 */
function renderBoard() {
  render(
    <>
      <Toaster />
      <Board lanes={lanes()} names={NAMES} seeAll={SEE_ALL} />
    </>,
  );
}

beforeEach(() => {
  // jsdom has no layout: give every element a box, as a shown one has.
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
});

afterEach(() => {
  vi.mocked(moveRequestAction).mockReset();
  vi.restoreAllMocks();
});

describe('Board', () => {
  it('names each lane with how many requests it has, and links to all of a fuller one', () => {
    renderBoard();

    expect(screen.getByRole('group', { name: 'Lanes' })).toBeInTheDocument();
    // jsdom has no CSS: the heading's text for phones and for wider screens both count here.
    expect(lane('Open')).toHaveAccessibleName(/^Open, 3 requests/);
    expect(lane('Done')).toHaveAccessibleName(/^Done, 1 request/);
    expect(within(lane('To do')).getByText('No requests')).toBeInTheDocument();
    // Open shows two of its three requests; Done shows all it has.
    expect(
      within(lane('Open')).getByRole('link', { name: 'See all 3 requests in Open' }),
    ).toHaveAttribute('href', '/requests?only=open');
    expect(within(lane('Done')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('offers the lanes a card may go to, and no menu on a card the reader can’t move', async () => {
    const user = userEvent.setup();
    renderBoard();

    expect(screen.queryByRole('button', { name: 'Move AD-3' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move AD-1' }));

    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['To do', 'In progress', 'Done', 'Cancelled']);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Move AD-1' })).toHaveFocus();
  });

  it('moves a card at once, busy alone, and saves it from the lane it was in', async () => {
    /** Answers the move, once the test has looked at the board while it's under way. */
    let answer: (result: ActionResult) => void = () => {};
    vi.mocked(moveRequestAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const user = userEvent.setup();
    renderBoard();

    await user.click(screen.getByRole('button', { name: 'Move AD-1' }));
    await user.click(screen.getByRole('menuitem', { name: 'In progress' }));

    expect(moveRequestAction).toHaveBeenCalledWith({
      request: 1,
      status: 'in_progress',
      from: 'open',
    });
    // In its new lane straight away, with the counts, and busy there; the other card isn't.
    const moved = within(lane('In progress')).getByRole('button', { name: 'Move AD-1' });
    expect(moved).toHaveAttribute('aria-busy', 'true');
    expect(moved).toHaveTextContent('Moving…');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Moving AD-1…');
    expect(lane('In progress')).toHaveAccessibleName(/^In progress, 1 request/);
    expect(lane('Open')).toHaveAccessibleName(/^Open, 2 requests/);
    expect(screen.getByRole('button', { name: 'Move AD-2' })).not.toHaveAttribute('aria-busy');
    // Focus followed the card to its Move button in the new lane.
    expect(moved).toHaveFocus();

    await act(async () => {
      answer({ ok: true, message: 'AD-1 moved to In progress.' });
    });
    await waitFor(() => expect(toasts()).toHaveTextContent('AD-1 moved to In progress.'));
  });

  it('asks before a card goes to Done, and moves nothing when the reader keeps it', async () => {
    vi.mocked(moveRequestAction).mockResolvedValue({ ok: true, message: 'AD-1 moved to Done.' });
    const user = userEvent.setup();
    renderBoard();

    await user.click(screen.getByRole('button', { name: 'Move AD-1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Done' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Mark AD-1 as done?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(moveRequestAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move AD-1' })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Move AD-1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Mark as done' }));

    expect(moveRequestAction).toHaveBeenCalledWith({ request: 1, status: 'done', from: 'open' });
  });

  it('asks before a card is cancelled, in the request page’s words', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(screen.getByRole('button', { name: 'Move AD-2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cancelled' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Cancel AD-2?' });
    expect(dialog).toHaveTextContent(
      'Cancel it when it’s no longer needed. It can be reopened later.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Keep request' }));
    expect(moveRequestAction).not.toHaveBeenCalled();
  });

  it('puts a refused card back, and says why above the lanes and as a toast', async () => {
    vi.mocked(moveRequestAction).mockResolvedValue({
      ok: false,
      message: 'This request’s status changed in the meantime. Check it and try again.',
    });
    const user = userEvent.setup();
    renderBoard();

    await user.click(screen.getByRole('button', { name: 'Move AD-2' }));
    await user.click(screen.getByRole('menuitem', { name: 'To do' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This request’s status changed in the meantime.',
    );
    await waitFor(() =>
      expect(toasts()).toHaveTextContent('This request’s status changed in the meantime.'),
    );
    // Back where it was once the move has ended, and focus with it.
    const back = await within(lane('Open')).findByRole('button', { name: 'Move AD-2' });
    await waitFor(() => expect(back).not.toHaveAttribute('aria-busy'));
    await waitFor(() => expect(back).toHaveFocus());
  });
});
