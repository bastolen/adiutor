/**
 * @file Tests for the table pagination: the row count, the page links
 * (Previous, Next, numbers and gaps), the page sizes, and the navigation's
 * focus keeper, which keeps keyboard users in the navigation when the control
 * they used disappears.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageLinkItem, PaginationLinks } from '@/lib/tables/table-state';

import renderInLocale from '../../../tests/i18n/render';
import stubLayout from '../../../tests/ui/layout';
import Pagination, { paginationFooter } from './pagination';

// Next's Link only calls `onNavigate` once the app router is mounted, which it isn't in these
// tests: this stand-in calls it for every plain click, as a client navigation would.
vi.mock('next/link', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/link')>();
  const { createElement } = await import('react');
  /**
   * A link that calls `onNavigate` instead of navigating.
   *
   * @param props - The link's props.
   * @param props.href - Where it goes.
   * @param props.onNavigate - Called on a click.
   * @param props.scroll - Ignored.
   * @returns The anchor.
   */
  function TestLink({
    href,
    onNavigate = undefined,
    scroll: _scroll = undefined,
    ...props
  }: Record<string, unknown> & {
    href: string;
    onNavigate?: (event: { preventDefault: () => void }) => void;
    scroll?: boolean;
  }) {
    /** Navigation can't be cancelled here: there's none. */
    function cancel() {}
    /** The navigation `onNavigate` gets. */
    const navigation = { preventDefault: cancel };
    /**
     * Calls `onNavigate` instead of following the link.
     *
     * @param event - The click.
     */
    function follow(event: MouseEvent) {
      event.preventDefault();
      onNavigate?.(navigation);
    }
    return createElement('a', { ...props, href, onClick: follow });
  }
  return { ...actual, default: TestLink };
});

/**
 * Matches an accessible name while ignoring whitespace. jsdom computes the
 * name of "Next<span class="sr-only"> page</span>" as "Nextpage" (it drops
 * the space around inline children, browsers keep it), so names that include
 * screen-reader-only text are compared without spaces; the tests that care
 * about the real spacing read the link's text content as well.
 *
 * @param expected - The name a browser computes, e.g. "Next page".
 * @returns A matcher for Testing Library's `name` option.
 */
function named(expected: string) {
  /**
   * Removes all whitespace.
   *
   * @param text - The text.
   * @returns The text without spaces.
   */
  const squash = (text: string) => text.replace(/\s+/g, '');
  return (name: string) => squash(name) === squash(expected);
}

/**
 * Gives elements a layout, which jsdom doesn't have: `getClientRects()` is
 * always empty there, so the focus keeper would see every link as hidden.
 * The page numbers sit in `<li class="hidden sm:block">`, so a small screen
 * is simulated by giving no rects to anything inside a `li.hidden`.
 *
 * @param screenSize - `small` hides the page numbers, as below the `sm` breakpoint.
 */
function stubScreen(screenSize: 'small' | 'large') {
  stubLayout((element) => screenSize === 'small' && element.closest('li.hidden') !== null);
}

/**
 * Stops a click on a link from navigating: jsdom can't, and says so in the
 * test output. Added to the document, so it runs after the app's own handlers.
 *
 * @param event - The click.
 */
function stopNavigation(event: Event) {
  event.preventDefault();
}

/**
 * Builds a page number item, linking to `/members?page=N`.
 *
 * @param page - The page.
 * @param current - Whether it's the page shown.
 * @returns The item.
 */
function pageItem(page: number, current = false): PageLinkItem {
  return { kind: 'page', page, href: `/members?page=${page}`, current };
}

/**
 * Builds the three page sizes, with one of them current.
 *
 * @param current - The size used now.
 * @returns The sizes, each linking to the first page.
 */
function sizeItems(current: 25 | 50 | 100 = 25): PaginationLinks['sizes'] {
  return ([25, 50, 100] as const).map((size) => ({
    size,
    href: `/members?size=${size}`,
    current: size === current,
  }));
}

/** The second of six pages of 132 members, 25 per page, with a gap before the last page. */
const SECOND_PAGE: PaginationLinks = {
  label: 'members',
  page: 2,
  pageCount: 6,
  total: 132,
  first: 26,
  last: 50,
  previousHref: '/members?page=1',
  nextHref: '/members?page=3',
  pages: [
    pageItem(1),
    pageItem(2, true),
    pageItem(3),
    { kind: 'gap', key: 'gap-end' },
    pageItem(6),
  ],
  sizes: sizeItems(25),
};

/** The only page of 12 members. */
const ONLY_PAGE: PaginationLinks = {
  label: 'members',
  page: 1,
  pageCount: 1,
  total: 12,
  first: 1,
  last: 12,
  previousHref: null,
  nextHref: null,
  pages: [pageItem(1, true)],
  sizes: sizeItems(25),
};

describe('Pagination', () => {
  describe('summary', () => {
    it('says which rows are shown, as a status message', () => {
      render(<Pagination {...SECOND_PAGE} />);

      expect(screen.getByRole('status')).toHaveTextContent('Showing 26–50 of 132');
    });

    it('separates the rows with an en dash', () => {
      render(<Pagination {...SECOND_PAGE} />);

      const text = screen.getByRole('status').textContent ?? '';
      expect(text).toContain('26–50');
      expect(text).not.toContain('26-50');
    });

    it('formats big numbers with a thousands separator', () => {
      render(
        <Pagination
          {...SECOND_PAGE}
          page={50}
          pageCount={50}
          first={1201}
          last={1225}
          total={1250}
        />,
      );

      expect(screen.getByRole('status')).toHaveTextContent('Showing 1,201–1,225 of 1,250');
    });
  });

  describe('page links', () => {
    it('is a navigation named after the rows', () => {
      render(<Pagination {...SECOND_PAGE} />);

      expect(screen.getByRole('navigation', { name: 'Pages of members' })).toBeInTheDocument();
    });

    it('names the navigation after other rows too', () => {
      render(<Pagination {...SECOND_PAGE} label="invitations" />);

      expect(screen.getByRole('navigation', { name: 'Pages of invitations' })).toBeInTheDocument();
    });

    it('links to the previous and next pages', () => {
      render(<Pagination {...SECOND_PAGE} />);

      expect(screen.getByRole('link', { name: named('Previous page') })).toHaveAttribute(
        'href',
        '/members?page=1',
      );
      expect(screen.getByRole('link', { name: named('Next page') })).toHaveAttribute(
        'href',
        '/members?page=3',
      );
      expect(
        screen.queryByRole('button', { name: named('Previous page') }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: named('Next page') })).not.toBeInTheDocument();
    });

    it('disables Previous on the first page', () => {
      render(
        <Pagination
          {...SECOND_PAGE}
          page={1}
          previousHref={null}
          pages={[
            pageItem(1, true),
            pageItem(2),
            pageItem(3),
            { kind: 'gap', key: 'gap-end' },
            pageItem(6),
          ]}
        />,
      );

      expect(screen.getByRole('button', { name: named('Previous page') })).toBeDisabled();
      expect(screen.queryByRole('link', { name: named('Previous page') })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: named('Next page') })).toBeInTheDocument();
    });

    it('disables Next on the last page', () => {
      render(
        <Pagination
          {...SECOND_PAGE}
          page={6}
          nextHref={null}
          previousHref="/members?page=5"
          pages={[pageItem(1), { kind: 'gap', key: 'gap-start' }, pageItem(5), pageItem(6, true)]}
        />,
      );

      expect(screen.getByRole('button', { name: named('Next page') })).toBeDisabled();
      expect(screen.queryByRole('link', { name: named('Next page') })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: named('Previous page') })).toBeInTheDocument();
    });

    it('links to each page number, and marks the current one', () => {
      render(<Pagination {...SECOND_PAGE} />);

      expect(screen.getByRole('link', { name: named('Page 3') })).toHaveAttribute(
        'href',
        '/members?page=3',
      );
      expect(screen.getByRole('link', { name: named('Page 1') })).toHaveAttribute(
        'href',
        '/members?page=1',
      );
      expect(screen.getByRole('link', { name: named('Page 6') })).toHaveAttribute(
        'href',
        '/members?page=6',
      );
      expect(screen.getByRole('link', { name: named('Page 2') })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByRole('link', { name: named('Page 1') })).not.toHaveAttribute(
        'aria-current',
      );
      expect(screen.getByRole('link', { name: named('Page 3') })).not.toHaveAttribute(
        'aria-current',
      );
    });

    it('names each link in full, and hides the short visible label from screen readers', () => {
      render(<Pagination {...SECOND_PAGE} />);

      const previous = screen.getByRole('link', { name: named('Previous page') });
      expect(within(previous).getByText('Previous')).toHaveAttribute('aria-hidden', 'true');
      const next = screen.getByRole('link', { name: named('Next page') });
      expect(within(next).getByText('Next')).toHaveAttribute('aria-hidden', 'true');
      const page = screen.getByRole('link', { name: named('Page 3') });
      expect(within(page).getByText('3')).toHaveAttribute('aria-hidden', 'true');
      const size = screen.getByRole('link', { name: named('50 per page') });
      expect(within(size).getByText('50')).toHaveAttribute('aria-hidden', 'true');
    });

    it('hides the gaps from assistive technology', () => {
      render(
        <Pagination
          {...SECOND_PAGE}
          page={3}
          pages={[
            pageItem(1),
            { kind: 'gap', key: 'gap-start' },
            pageItem(3, true),
            { kind: 'gap', key: 'gap-end' },
            pageItem(6),
          ]}
        />,
      );

      const gaps = screen.getAllByText('…');
      expect(gaps).toHaveLength(2);
      gaps.forEach((gap) => expect(gap).toHaveAttribute('aria-hidden', 'true'));
    });

    it('says which page it is on in words for small screens', () => {
      render(<Pagination {...SECOND_PAGE} />);

      expect(
        within(screen.getByRole('navigation', { name: 'Pages of members' })).getByText(
          'Page 2 of 6',
        ),
      ).toBeInTheDocument();
    });

    it('shows no navigation with a single page, but still the summary and page sizes', () => {
      render(<Pagination {...ONLY_PAGE} />);

      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: named('Next page') })).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Showing 1–12 of 12');
      expect(screen.getByRole('group', { name: /Per page/ })).toBeInTheDocument();
    });
  });

  describe('page sizes', () => {
    it('is a group named after the rows', () => {
      render(<Pagination {...SECOND_PAGE} />);

      expect(screen.getByRole('group', { name: /Per page/ })).toHaveAccessibleName(
        'Per page, members',
      );
    });

    it('links to each size', () => {
      render(<Pagination {...SECOND_PAGE} />);

      const group = screen.getByRole('group', { name: /Per page/ });
      expect(within(group).getByRole('link', { name: named('25 per page') })).toHaveAttribute(
        'href',
        '/members?size=25',
      );
      expect(within(group).getByRole('link', { name: named('50 per page') })).toHaveAttribute(
        'href',
        '/members?size=50',
      );
      expect(within(group).getByRole('link', { name: named('100 per page') })).toHaveAttribute(
        'href',
        '/members?size=100',
      );
    });

    it('marks the size used now as current', () => {
      render(<Pagination {...SECOND_PAGE} sizes={sizeItems(50)} />);

      expect(screen.getByRole('link', { name: named('50 per page') })).toHaveAttribute(
        'aria-current',
        'true',
      );
      expect(screen.getByRole('link', { name: named('25 per page') })).not.toHaveAttribute(
        'aria-current',
      );
      expect(screen.getByRole('link', { name: named('100 per page') })).not.toHaveAttribute(
        'aria-current',
      );
    });

    it('tells several tables on one page apart', () => {
      render(
        <>
          <Pagination {...SECOND_PAGE} />
          <Pagination {...SECOND_PAGE} label="invitations" />
        </>,
      );

      expect(screen.getByRole('group', { name: 'Per page, members' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Per page, invitations' })).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Pages of members' })).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Pages of invitations' })).toBeInTheDocument();
    });
  });

  describe('focus', () => {
    beforeEach(() => {
      stubScreen('large');
      document.addEventListener('click', stopNavigation);
    });

    afterEach(() => {
      document.removeEventListener('click', stopNavigation);
      vi.restoreAllMocks();
    });

    /** The third and last of three pages. */
    const LAST_PAGE: PaginationLinks = {
      ...SECOND_PAGE,
      page: 3,
      pageCount: 3,
      first: 51,
      last: 60,
      total: 60,
      previousHref: '/members?page=2',
      nextHref: null,
      pages: [pageItem(1), pageItem(2), pageItem(3, true)],
    };

    /** The second of three pages. */
    const MIDDLE_PAGE: PaginationLinks = {
      ...LAST_PAGE,
      page: 2,
      first: 26,
      last: 50,
      previousHref: '/members?page=1',
      nextHref: '/members?page=3',
      pages: [pageItem(1), pageItem(2, true), pageItem(3)],
    };

    it('moves to the current page when Next, used to get here, is gone', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Pagination {...MIDDLE_PAGE} />);

      await user.click(screen.getByRole('link', { name: named('Next page') }));
      expect(screen.getByRole('link', { name: named('Next page') })).toHaveFocus();

      rerender(<Pagination {...LAST_PAGE} />);

      expect(screen.queryByRole('link', { name: named('Next page') })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: named('Next page') })).toBeDisabled();
      expect(screen.getByRole('link', { name: named('Page 3') })).toHaveFocus();
    });

    it('does the same after pressing Enter in the navigation', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Pagination {...MIDDLE_PAGE} />);

      screen.getByRole('link', { name: named('Next page') }).focus();
      await user.keyboard('{Enter}');
      rerender(<Pagination {...LAST_PAGE} />);

      expect(screen.getByRole('link', { name: named('Page 3') })).toHaveFocus();
    });

    it('ignores other keys', () => {
      const { rerender } = render(<Pagination {...MIDDLE_PAGE} />);

      const next = screen.getByRole('link', { name: named('Next page') });
      next.focus();
      fireEvent.keyDown(next, { key: 'Tab' });
      rerender(<Pagination {...LAST_PAGE} />);

      expect(document.body).toHaveFocus();
    });

    it('falls back to the first link when no page is current', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Pagination {...MIDDLE_PAGE} />);

      await user.click(screen.getByRole('link', { name: named('Next page') }));
      rerender(<Pagination {...LAST_PAGE} pages={[]} />);

      expect(screen.getByRole('link', { name: named('Previous page') })).toHaveFocus();
    });

    it('moves to a link that is shown when the page numbers are hidden on a small screen', async () => {
      stubScreen('small');
      const user = userEvent.setup();
      const { rerender } = render(<Pagination {...MIDDLE_PAGE} />);

      await user.click(screen.getByRole('link', { name: named('Next page') }));
      rerender(<Pagination {...LAST_PAGE} />);

      expect(screen.getByRole('link', { name: named('Previous page') })).toHaveFocus();
    });

    it('leaves focus alone when the control used is still there', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Pagination {...MIDDLE_PAGE} />);

      const next = screen.getByRole('link', { name: named('Next page') });
      await user.click(next);
      rerender(
        <Pagination
          {...MIDDLE_PAGE}
          page={3}
          pageCount={4}
          previousHref="/members?page=2"
          nextHref="/members?page=4"
          pages={[pageItem(2), pageItem(3, true), pageItem(4)]}
        />,
      );

      expect(screen.getByRole('link', { name: named('Next page') })).toHaveFocus();
      expect(screen.getByRole('link', { name: named('Page 3') })).not.toHaveFocus();
    });

    it('leaves focus alone on a plain re-render, without a click in the navigation', () => {
      const { rerender } = render(<Pagination {...MIDDLE_PAGE} />);
      expect(document.body).toHaveFocus();

      rerender(<Pagination {...LAST_PAGE} />);

      expect(document.body).toHaveFocus();
      expect(screen.getByRole('link', { name: named('Page 3') })).not.toHaveFocus();
    });

    it('leaves focus alone when a click is followed by a page change elsewhere', () => {
      const { rerender } = render(
        <>
          <button type="button">Elsewhere</button>
          <Pagination {...MIDDLE_PAGE} />
        </>,
      );

      screen.getByRole('button', { name: 'Elsewhere' }).focus();
      rerender(
        <>
          <button type="button">Elsewhere</button>
          <Pagination {...LAST_PAGE} />
        </>,
      );

      expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
    });

    it('moves focus only once per click', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Pagination {...MIDDLE_PAGE} />);

      await user.click(screen.getByRole('link', { name: named('Next page') }));
      rerender(<Pagination {...LAST_PAGE} />);
      expect(screen.getByRole('link', { name: named('Page 3') })).toHaveFocus();

      (document.activeElement as HTMLElement).blur();
      rerender(<Pagination {...MIDDLE_PAGE} />);

      expect(document.body).toHaveFocus();
    });
  });
});

describe('paginationFooter', () => {
  it('is nothing when every row fits on one page', () => {
    const pagination = vi.fn(() => SECOND_PAGE);

    const footer = paginationFooter(
      { pagination },
      { items: [], total: 10, page: 1, size: 25 },
      'members',
    );

    expect(footer).toBe(false);
    expect(pagination).not.toHaveBeenCalled();
  });

  it('is the pagination of the rows it is given when they take more than one page', () => {
    const pagination = vi.fn(() => SECOND_PAGE);
    const paged = { items: [], total: 132, page: 2, size: 25 as const };

    render(paginationFooter({ pagination }, paged, 'members'));

    expect(pagination).toHaveBeenCalledWith(paged, 'members');
    expect(screen.getByRole('status')).toHaveTextContent('26–50 of 132');
  });

  it('shows from the first row past what fits on one page', () => {
    const pagination = vi.fn(() => SECOND_PAGE);

    const footer = paginationFooter(
      { pagination },
      { items: [], total: 11, page: 1, size: 25 },
      'members',
    );

    expect(footer).not.toBe(false);
  });
});

describe('Pagination in other languages', () => {
  it.each([
    ['nl-NL', '26–50 van 132', 'Vorige pagina', 'Pagina 3', '50 per pagina'],
    ['es-ES', '26–50 de 132', 'Página anterior', 'Página 3', '50 por página'],
  ] as const)('speaks %s', (locale, status, previous, page, size) => {
    renderInLocale(locale, <Pagination {...SECOND_PAGE} />);

    expect(screen.getByRole('status')).toHaveTextContent(status);
    expect(screen.getByRole('link', { name: named(previous) })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: named(page) })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: named(size) })).toBeInTheDocument();
  });
});
