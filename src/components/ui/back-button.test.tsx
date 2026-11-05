/**
 * @file Tests for the "Go back" button: shown only when the tab has a
 * previous page, and going back through the router.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BackButton from './back-button';

/** Mocked router. */
const { back } = vi.hoisted(() => ({ back: vi.fn() }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `back` is recorded.
   */
  useRouter: () => ({ back }),
}));

/**
 * Pretends the browser has the Navigation API.
 *
 * @param canGoBack - What `navigation.canGoBack` reports.
 */
function stubNavigation(canGoBack: boolean) {
  vi.stubGlobal('navigation', { canGoBack });
}

describe('BackButton', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    back.mockReset();
  });

  it('renders nothing on the server', () => {
    expect(renderToString(<BackButton />)).toBe('');
  });

  it('goes back when the tab has a previous page', async () => {
    const user = userEvent.setup();
    stubNavigation(true);
    render(<BackButton />);

    await user.click(screen.getByRole('button', { name: 'Go back' }));

    expect(back).toHaveBeenCalledOnce();
  });

  it('stays hidden when the tab has no previous page', () => {
    stubNavigation(false);
    render(<BackButton />);

    expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument();
  });

  it('falls back to the history length without the Navigation API', () => {
    // jsdom has no Navigation API, and a fresh tab's history has one entry.
    render(<BackButton />);
    expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument();

    window.history.pushState({}, '', '/elsewhere');
    render(<BackButton />);
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
  });
});
