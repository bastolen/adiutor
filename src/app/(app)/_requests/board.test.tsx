/**
 * @file Tests for the browser part of the board of requests: the lanes with
 * their counts, "See all" and an empty lane, the Move menu (none on a card
 * the reader can't move), moving a card at once and saving it from the lane
 * it was in, Done and Cancelled asking first, a refusal, and where focus goes
 * after a move; and dragging, with the drag and drop itself stood in for:
 * what it's given, what the lanes say while a card is dragged, what's
 * announced, and what each kind of drop does (refused ones worded per
 * reason).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Toaster } from '@/components/ui/toast';
import type { ActionResult } from '@/lib/action-result';
import { defined } from '@/lib/defined';
import type { BoardLaneState, RequestStatus } from '@/lib/requests';

import Board from './board';
import { moveRequestAction } from './board-actions';
import type { BoardCardView } from './board-card';
import type { BoardDragEvents, DraggedCard } from './board-drag';

vi.mock('./board-actions', () => ({ moveRequestAction: vi.fn() }));

/** A stand-in for the drag and drop: it notes what the board gives it. */
const dragKit = vi.hoisted(() => {
  const given = {
    /** The cards made draggable, by request ID. */
    cards: new Map<string, { handle: HTMLElement; card: () => DraggedCard | null }>(),
    /** The lanes that take cards. */
    lanes: [] as string[],
    /** What the board hears of a drag, while it's watched. */
    events: null as BoardDragEvents | null,
  };
  return {
    given,
    kit: {
      card: vi.fn(
        (args: { element: HTMLElement; handle: HTMLElement; card: () => DraggedCard | null }) => {
          const id = args.handle.dataset.dragHandle ?? '';
          given.cards.set(id, args);
          return () => given.cards.delete(id);
        },
      ),
      lane: vi.fn(({ lane }: { lane: string }) => {
        given.lanes.push(lane);
        return () => {
          given.lanes.splice(given.lanes.indexOf(lane), 1);
        };
      }),
      watch: vi.fn(({ events }: { events: BoardDragEvents }) => {
        given.events = events;
        return () => {
          given.events = null;
        };
      }),
    },
  };
});

vi.mock('./board-drag', () => ({ default: dragKit.kit }));

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
    audience: moves.length > 2 ? 'staff' : 'contributor',
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
      <Board lanes={lanes()} names={NAMES} seeAll={SEE_ALL} staffName="Adiutor Tests" />
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
    expect(screen.getByText('Moving AD-1…')).toHaveAttribute('role', 'status');
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

describe('Board, dragging', () => {
  /**
   * Makes the window as wide as a tablet or not, as the board asks.
   *
   * @param wide - Whether it's tablet width or wider.
   */
  function windowIsWide(wide: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: wide,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  }

  /**
   * The live region that says what happens while a card is dragged.
   *
   * @returns It.
   */
  const announced = () =>
    defined(
      screen.getAllByRole('status').find((element) => element.tagName === 'P'),
      'the live region',
    );

  /**
   * What the board hears of a drag, once the drag and drop has loaded.
   *
   * @returns The events.
   */
  async function dragEvents(): Promise<BoardDragEvents> {
    await waitFor(() => expect(dragKit.given.events).not.toBeNull());
    return defined(dragKit.given.events, 'the drag events');
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads nowhere below tablet width, where the Move menu is the only way', async () => {
    windowIsWide(false);
    renderBoard();

    await act(async () => {});
    expect(dragKit.kit.watch).not.toHaveBeenCalled();
    expect(document.querySelector('[data-drag-handle]')).toBeNull();
  });

  it('gives each card the reader may move a grip, and every lane a drop target', async () => {
    windowIsWide(true);
    renderBoard();
    await dragEvents();

    expect([...dragKit.given.cards.keys()].sort()).toEqual(['request-1', 'request-2']);
    expect(document.querySelector('[data-drag-handle="request-3"]')).toBeNull();
    expect(dragKit.given.cards.get('request-1')?.handle).toHaveAttribute('aria-hidden', 'true');
    expect(dragKit.given.cards.get('request-1')?.card()).toEqual({
      id: 'request-1',
      status: 'open',
      moves: ['todo', 'in_progress', 'done', 'cancelled'],
    });
    expect([...dragKit.given.lanes].sort()).toEqual(Object.keys(NAMES).sort());
  });

  it('says on each lane whether the card can go there, and announces where the pointer is', async () => {
    windowIsWide(true);
    renderBoard();
    const events = await dragEvents();

    act(() => events.onStart({ id: 'request-1', status: 'open', moves: ['todo', 'done'] }));
    expect(announced()).toHaveTextContent('AD-1 picked up.');
    expect(within(lane('Waiting for approval')).getByText('Can’t move here')).toBeInTheDocument();
    expect(within(lane('To do')).queryByText('Can’t move here')).not.toBeInTheDocument();
    expect(within(lane('Open')).queryByText('Can’t move here')).not.toBeInTheDocument();

    act(() => events.onOver('todo'));
    expect(within(lane('To do')).getByText('Let go to move it here')).toBeInTheDocument();
    expect(announced()).toHaveTextContent('Over To do: let go to move AD-1 there.');
    act(() => events.onOver('waiting'));
    expect(announced()).toHaveTextContent('Over Waiting for the company: AD-1 can’t move here.');
  });

  it('moves a card dropped on a lane it may go to, as the Move menu does', async () => {
    vi.mocked(moveRequestAction).mockResolvedValue({ ok: true, message: 'AD-1 moved to To do.' });
    windowIsWide(true);
    renderBoard();
    const events = await dragEvents();
    const dragged = { id: 'request-1', status: 'open' as const, moves: ['todo' as const] };

    act(() => events.onStart(dragged));
    act(() => events.onDrop(dragged, { accepted: 'todo', under: 'todo' }));

    expect(moveRequestAction).toHaveBeenCalledWith({ request: 1, status: 'todo', from: 'open' });
    expect(within(lane('To do')).getByRole('button', { name: 'Move AD-1' })).toBeInTheDocument();
    expect(screen.queryByText('Can’t move here')).not.toBeInTheDocument();
  });

  it('asks before a card dropped on Done moves', async () => {
    windowIsWide(true);
    renderBoard();
    const events = await dragEvents();
    const dragged = { id: 'request-1', status: 'open' as const, moves: ['done' as const] };

    act(() => events.onStart(dragged));
    act(() => events.onDrop(dragged, { accepted: 'done', under: 'done' }));

    expect(screen.getByRole('alertdialog', { name: 'Mark AD-1 as done?' })).toBeInTheDocument();
    expect(moveRequestAction).not.toHaveBeenCalled();
  });

  it('sends nothing for a drop on a lane the card can’t go to, and says why', async () => {
    windowIsWide(true);
    renderBoard();
    const events = await dragEvents();
    const dragged = { id: 'request-1', status: 'open' as const, moves: ['todo' as const] };

    act(() => events.onStart(dragged));
    act(() => events.onDrop(dragged, { accepted: null, under: 'proposed' }));

    expect(moveRequestAction).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'AD-1 waits for approval only once a reply is sent as its solution.',
    );
    await waitFor(() =>
      expect(toasts()).toHaveTextContent('AD-1 waits for approval only once a reply is sent'),
    );
    expect(within(lane('Open')).getByRole('button', { name: 'Move AD-1' })).toBeInTheDocument();
  });

  it('leaves a card dropped on its own lane, or between lanes, where it was', async () => {
    windowIsWide(true);
    renderBoard();
    const events = await dragEvents();
    const dragged = { id: 'request-2', status: 'open' as const, moves: ['todo' as const] };

    act(() => events.onStart(dragged));
    act(() => events.onDrop(dragged, { accepted: null, under: 'open' }));
    act(() => events.onStart(dragged));
    act(() => events.onDrop(dragged, { accepted: null, under: null }));

    expect(moveRequestAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(announced()).toHaveTextContent('AD-2 stays where it was.');
  });
});

describe('a refused drop', () => {
  it.each([
    ['readOnly', 'AD-9 stays where it is: you can only read it.'],
    [
      'proposedComesWithReply',
      'AD-9 waits for approval only once a reply is sent as its solution.',
    ],
    ['approveOnRequest', 'To close AD-9, approve or deny its solution on the request.'],
    ['staffSetsThat', 'Only Adiutor Tests can move AD-9 to that lane.'],
    ['notFromHere', 'AD-9 can’t move to that lane from where it is.'],
  ])('says why for %s', async (reason, sentence) => {
    const { useTranslations } = await import('next-intl');
    /**
     * Words the refusal, as the board does.
     *
     * @returns The sentence.
     */
    function Refusal() {
      const t = useTranslations('requests.board');
      return <p>{t('refused', { reason, reference: 'AD-9', staff: 'Adiutor Tests' })}</p>;
    }
    render(<Refusal />);
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });
});
