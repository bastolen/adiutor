/**
 * @file Tests for the note after users changed their own access: known codes
 * show their note and can be dismissed, anything else shows nothing.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AccessNotice from './access-notice';
import { ACCESS_NOTICES, getAccessNotice, withAccessNotice } from './access-notices';

/** The address's query string, as the page was opened with. */
const { search } = vi.hoisted(() => ({ search: { current: '' } }));

vi.mock('next/navigation', () => ({
  /**
   * The page's query parameters.
   *
   * @returns Them, from {@link search}.
   */
  useSearchParams: () => new URLSearchParams(search.current),
}));

beforeEach(() => {
  search.current = '';
});

describe('AccessNotice', () => {
  it('shows the note for a known code, focused, until dismissed', async () => {
    const user = userEvent.setup();
    search.current = 'notice=left-staff';
    render(<AccessNotice />);

    const note = screen.getByRole('status');
    expect(note).toHaveTextContent(ACCESS_NOTICES['left-staff']);
    expect(note).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Dismiss this note' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['', 'notice=', 'notice=toString', 'notice=__proto__', 'notice=<b>hi</b>'])(
    'shows nothing for "%s"',
    (query) => {
      search.current = query;
      const { container } = render(<AccessNotice />);
      expect(container).toBeEmptyDOMElement();
    },
  );
});

describe('access notices', () => {
  it('builds the address with the code and reads only known codes back', () => {
    expect(withAccessNotice('/dashboard', 'stepped-down')).toBe('/dashboard?notice=stepped-down');
    expect(getAccessNotice('company-stepped-down')).toBe(ACCESS_NOTICES['company-stepped-down']);
    expect(getAccessNotice('hasOwnProperty')).toBeNull();
    expect(getAccessNotice(null)).toBeNull();
  });
});
