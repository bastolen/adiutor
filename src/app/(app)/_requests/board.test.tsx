/**
 * @file Tests for the browser part of the board of requests: the lanes with
 * their counts, "See all" and an empty lane, the Move menu (none on a card
 * the reader can't move), moving a card at once and saving it from the lane
 * it was in, Done and Cancelled asking first, a refusal, and where focus goes
 * after a move; the row that jumps to a column while the lanes scroll; and
 * dragging, with the drag and drop itself stood in for:
 * what it's given, what the lanes say while a card is dragged, what's
 * announced, and what each kind of drop does (refused ones worded per
 * reason).
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
      lane: vi.fn(({ lane }: { lane: string; element: HTMLElement }) => {
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
 * @returns The lane's group.
 */
const lane = (name: string) => screen.getByRole('group', { name: new RegExp(`^${name},`) });

/**
 * The toasts on the screen.
 *
 * @returns Their region.
 */
const toasts = () => screen.getByRole('region', { name: /^Notifications/ });

/**
 * The board's live region, which says what happens while a card is dragged
 * or moved.
 *
 * @returns It.
 */
const liveRegion = () =>
  defined(
    screen.getAllByRole('status').find((element) => element.tagName === 'P'),
    'the live region',
  );

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

  it('makes its columns groups, not landmarks, and says when a lane shows fewer cards than it holds', () => {
    renderBoard();

    // The only landmark here is the toasts': the lanes are groups named by their headings.
    expect(screen.getAllByRole('region')).toEqual([toasts()]);
    expect(
      within(lane('Open')).getByRole('heading', { level: 2, name: /^Open, 3 requests/ }),
    ).toBeInTheDocument();
    // Open shows the first two of its three requests; Done shows all it has.
    expect(within(lane('Open')).getByRole('list')).toHaveAccessibleName('First 2 of 3');
    expect(within(lane('Done')).getByRole('list')).not.toHaveAttribute('aria-label');
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
    // The live region is on the page before anything happens, so what it says next is read out.
    const live = liveRegion();
    expect(live).toBeEmptyDOMElement();

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
    expect(moved).toHaveAttribute('aria-disabled', 'true');
    expect(moved).toHaveTextContent('Moving…');
    // Said once, by the board's live region; the card adds no status of its own.
    expect(live).toHaveTextContent('Moving AD-1 to In progress…');
    expect(screen.getAllByText('Moving AD-1 to In progress…')).toEqual([live]);
    expect(lane('In progress')).toHaveAccessibleName(/^In progress, 1 request/);
    expect(lane('Open')).toHaveAccessibleName(/^Open, 2 requests/);
    expect(screen.getByRole('button', { name: 'Move AD-2' })).not.toHaveAttribute('aria-busy');
    // Focus followed the card to its Move button in the new lane.
    expect(moved).toHaveFocus();

    await act(async () => {
      answer({ ok: true, message: 'AD-1 moved to In progress.' });
    });
    await waitFor(() => expect(toasts()).toHaveTextContent('AD-1 moved to In progress.'));
    // The toast says how it went; the live region has gone quiet, so nothing is said twice.
    expect(live).toBeEmptyDOMElement();
    expect(liveRegion()).toBe(live);
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
    // The alert says why; the live region no longer says it's moving.
    expect(liveRegion()).toBeEmptyDOMElement();
    // Back where it was once the move has ended, and focus with it.
    const back = await within(lane('Open')).findByRole('button', { name: 'Move AD-2' });
    await waitFor(() => expect(back).not.toHaveAttribute('aria-busy'));
    await waitFor(() => expect(back).toHaveFocus());
  });
});

describe('Board, its jump row', () => {
  /**
   * Stands in for `ResizeObserver`, which jsdom doesn't have: an element is
   * measured as soon as it's observed, and again when the test resizes it.
   *
   * @returns A function that resizes an observed element.
   */
  function observeSizes(): (element: Element) => void {
    const observed = new Map<Element, () => void>();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        /** What's called with the sizes. */
        callback: ResizeObserverCallback;

        /** The elements this observer measures. */
        elements: Element[] = [];

        /**
         * Keeps the callback.
         *
         * @param callback - What's called with the sizes.
         */
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }

        /**
         * Measures at once, as the browser does once the element is laid out.
         *
         * @param element - The element.
         */
        observe(element: Element) {
          /**
           * Measures the element.
           *
           * @returns Nothing.
           */
          const measure = () => this.callback([], this as unknown as ResizeObserver);
          this.elements.push(element);
          observed.set(element, measure);
          measure();
        }

        /** Stops measuring: nothing is called anymore. */
        disconnect() {
          this.elements.forEach((element) => observed.delete(element));
        }
      },
    );
    return (element) => {
      act(() => observed.get(element)?.());
    };
  }

  /**
   * Makes the lanes' row wider than its box or not, as the board measures
   * it (jsdom has no layout).
   *
   * @param scrolls - Whether the row is wider than its box.
   */
  function rowScrolls(scrolls: boolean) {
    observeSizes();
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(scrolls ? 1800 : 1000);
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  }

  /**
   * The jump row on the screen.
   *
   * @returns Its navigation.
   */
  const jumpRow = () => screen.getByRole('navigation', { name: 'Jump to a lane' });

  /**
   * A column of the board.
   *
   * @param key - The column's key.
   * @returns Its element.
   */
  const column = (key: string) =>
    defined(document.querySelector<HTMLElement>(`[data-column="${key}"]`), `the ${key} column`);

  /**
   * Stands in for the row's scrolling and where the row and a column are,
   * which jsdom doesn't lay out.
   *
   * @param key - The column that's 1200px to the right of the row's start.
   * @returns The row's `scrollTo`.
   */
  function placeColumn(key: string) {
    const row = screen.getByRole('group', { name: 'Lanes' });
    const scrollTo = vi.fn();
    row.scrollTo = scrollTo;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 100 } as DOMRect);
    vi.spyOn(column(key), 'getBoundingClientRect').mockReturnValue({ left: 1300 } as DOMRect);
    return scrollTo;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is on the page from the start, shown by the board’s width from tablet width', () => {
    renderBoard();
    // CSS shows it while the board is narrower than its five columns side by side: no measuring,
    // so nothing shifts once the page runs.
    expect(jumpRow()).toHaveClass('hidden', 'md:flex', '@min-[73rem]:hidden');
    expect(jumpRow().closest('.\\@container')).toBe(
      screen.getByRole('group', { name: 'Lanes' }).parentElement,
    );
    // Before it's measured, the row stays reachable with the keyboard; once it fits, it's not.
    expect(screen.getByRole('group', { name: 'Lanes' })).toHaveAttribute('tabindex', '0');
    cleanup();

    rowScrolls(false);
    renderBoard();
    expect(screen.getByRole('group', { name: 'Lanes' })).not.toHaveAttribute('tabindex');
  });

  it('has a button per column with its count', () => {
    renderBoard();

    expect(
      within(jumpRow())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      'Open3Open, 3 requests',
      'To do0To do, 0 requests',
      'In progress0In progress, 0 requests',
      'Waiting0Waiting, 0 requests',
      'Closed1Closed, 1 request',
    ]);
    // Named like the column's heading; the count beside the name is hidden from screen readers.
    expect(within(jumpRow()).getByRole('button', { name: 'Closed, 1 request' })).toBeVisible();
  });

  it('writes a count as the reader’s language writes numbers, as the name says it', () => {
    const many = lanes().map((each) => (each.status === 'open' ? { ...each, total: 1234 } : each));
    render(<Board lanes={many} names={NAMES} seeAll={SEE_ALL} staffName="Adiutor Tests" />);

    expect(
      within(jumpRow()).getByRole('button', { name: 'Open, 1,234 requests' }),
    ).toHaveTextContent(/^Open1,234/);
  });

  it('moves the focus to the main content when the row hides while it has it', async () => {
    const resize = observeSizes();
    render(
      <main id="main">
        <Board lanes={lanes()} names={NAMES} seeAll={SEE_ALL} staffName="Adiutor Tests" />
      </main>,
    );
    const button = within(jumpRow()).getByRole('button', { name: 'Open, 3 requests' });
    act(() => button.focus());

    // A wider window: the board's lanes fit, and the container query hides the row.
    const hidden = [] as unknown as DOMRectList;
    vi.spyOn(jumpRow(), 'getClientRects').mockReturnValue(hidden);
    vi.spyOn(button, 'getClientRects').mockReturnValue(hidden);
    resize(jumpRow());

    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  });

  it('scrolls the row to a column and puts the focus on its heading', async () => {
    const user = userEvent.setup();
    renderBoard();
    const scrollTo = placeColumn('closed');

    await user.click(within(jumpRow()).getByRole('button', { name: 'Closed, 1 request' }));

    expect(scrollTo).toHaveBeenCalledWith({ left: 1200, behavior: 'smooth' });
    // The column's own heading, not its halves'.
    expect(within(column('closed')).getByRole('heading', { level: 2 })).toHaveFocus();
  });

  it('jumps without smooth scrolling for someone who asked for less motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const user = userEvent.setup();
    renderBoard();
    const scrollTo = placeColumn('in_progress');

    await user.click(within(jumpRow()).getByRole('button', { name: 'In progress, 0 requests' }));

    expect(scrollTo).toHaveBeenCalledWith({ left: 1200, behavior: 'instant' });
    expect(within(column('in_progress')).getByRole('heading', { level: 2 })).toHaveFocus();
  });

  it('counts the cards as the board shows them, a move under way too', async () => {
    /** Answers the move, once the test has looked at the row while it's under way. */
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

    expect(within(jumpRow()).getByRole('button', { name: 'Open, 2 requests' })).toBeVisible();
    expect(within(jumpRow()).getByRole('button', { name: 'In progress, 1 request' })).toBeVisible();
    await act(async () => {
      answer({ ok: true, message: 'AD-1 moved to In progress.' });
    });
  });
});

describe('Board, its grouped columns', () => {
  it('shows Waiting and Closed with two halves each, every half with its count, See all and empty text', () => {
    const grouped = lanes().map((each) => {
      if (each.status === 'waiting') {
        return { ...each, total: 1, items: [card(4, 'waiting', ['open', 'todo'])] };
      }
      return each.status === 'done' ? { ...each, total: 7 } : each;
    });
    render(<Board lanes={grouped} names={NAMES} seeAll={SEE_ALL} staffName="Adiutor Tests" />);

    const closed = screen.getByRole('group', { name: /^Closed, 7 requests/ });
    const done = within(closed).getByRole('group', { name: 'Done, 7 requests' });
    const cancelled = within(closed).getByRole('group', { name: 'Cancelled, 0 requests' });
    // Done above Cancelled, each its own lane.
    expect(done.compareDocumentPosition(cancelled)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(done).getByRole('heading', { level: 3 })).toBeInTheDocument();
    // A closed lane shows its latest cards, and says so.
    expect(within(done).getByRole('list')).toHaveAccessibleName('Latest 1 of 7');
    expect(within(done).getByRole('link', { name: 'See all 7 requests in Done' })).toHaveAttribute(
      'href',
      '/requests?only=done',
    );
    expect(within(cancelled).getByText('No requests')).toBeInTheDocument();

    const waiting = screen.getByRole('group', { name: /^Waiting, 1 request/ });
    expect(
      within(waiting).getByRole('group', { name: 'Waiting for the company, 1 request' }),
    ).toHaveTextContent('Request 4');
    expect(
      within(
        within(waiting).getByRole('group', { name: 'Waiting for approval, 0 requests' }),
      ).getByText('No requests'),
    ).toBeInTheDocument();
    // Five columns in all.
    expect(document.querySelectorAll('[data-column]')).toHaveLength(5);
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
    // Each half of a grouped column takes cards on its own; the column itself takes none.
    const targets = dragKit.kit.lane.mock.calls.map(([args]) => args);
    const done = targets.find(({ lane: status }) => status === 'done');
    expect(done?.element).toHaveAttribute('data-lane', 'done');
    expect(done?.element).not.toHaveAttribute('data-column');
    expect(done?.element.closest('[data-column]')).toHaveAttribute('data-column', 'closed');
  });

  it('says what letting go over each Closed half does, and Waiting for approval never takes it', async () => {
    windowIsWide(true);
    renderBoard();
    const events = await dragEvents();

    act(() =>
      events.onStart({ id: 'request-1', status: 'open', moves: ['todo', 'done', 'cancelled'] }),
    );
    act(() => events.onOver('done'));
    expect(within(lane('Done')).getByText('Let go to mark it as done')).toBeInTheDocument();
    act(() => events.onOver('cancelled'));
    expect(within(lane('Cancelled')).getByText('Let go to cancel it')).toBeInTheDocument();
    act(() => events.onOver('proposed'));
    expect(within(lane('Waiting for approval')).getByText('Can’t move here')).toBeInTheDocument();
  });

  it('says on each lane whether the card can go there, and announces where the pointer is', async () => {
    windowIsWide(true);
    renderBoard();
    const events = await dragEvents();

    act(() => events.onStart({ id: 'request-1', status: 'open', moves: ['todo', 'done'] }));
    expect(liveRegion()).toHaveTextContent('AD-1 picked up.');
    expect(within(lane('Waiting for approval')).getByText('Can’t move here')).toBeInTheDocument();
    expect(within(lane('To do')).queryByText('Can’t move here')).not.toBeInTheDocument();
    expect(within(lane('Open')).queryByText('Can’t move here')).not.toBeInTheDocument();

    act(() => events.onOver('todo'));
    expect(within(lane('To do')).getByText('Let go to move it here')).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('Over To do: let go to move AD-1 there.');
    act(() => events.onOver('waiting'));
    expect(liveRegion()).toHaveTextContent('Over Waiting for the company: AD-1 can’t move here.');
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
    // Where it went is said once, by the move itself.
    expect(liveRegion()).toHaveTextContent('Moving AD-1 to To do…');
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
    // While its question is open (the dialog hides the rest of the page from screen readers),
    // the live region says where it was let go.
    expect(document.querySelector('p[role="status"]')).toHaveTextContent('AD-1 let go over Done.');
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
    expect(liveRegion()).toHaveTextContent('AD-2 stays where it was.');
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
