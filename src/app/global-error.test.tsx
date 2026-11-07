/**
 * @file Tests for the last-resort error page: it renders a whole document
 * (with its title and the root error page) and applies the saved theme
 * itself, since the root layout's inline script isn't there.
 */
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY } from '@/lib/theme';

import GlobalError from './global-error';
import reportErrorAction from './report-error-action';

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router that does nothing.
   */
  useRouter: () => ({ back: vi.fn() }),
}));

vi.mock('./report-error-action', () => ({ default: vi.fn(async () => null) }));

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.mocked(reportErrorAction).mockClear();
  vi.unstubAllGlobals();
});

/**
 * Makes `window.matchMedia` report the given system setting.
 *
 * @param dark - Whether the system is set to dark mode.
 */
function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: dark && query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

/** An error from the root layout, as it comes from the server. */
const error = Object.assign(new Error('Server Components render'), { digest: '2828711936' });

describe('GlobalError', () => {
  it('renders a whole document with its title and the error page', () => {
    const html = renderToStaticMarkup(<GlobalError error={error} retry={vi.fn()} />);

    expect(html).toMatch(/^<html lang="en">/);
    expect(html).toMatch(/<head>.*<title>Something went wrong · Adiutor<\/title>.*<\/head>/);
    expect(html).toContain('<body class="bg-background text-foreground antialiased">');
    expect(html).toContain('Something went wrong</h1>');
    expect(html).toContain('Try again');
  });

  it('applies the saved theme, as the inline script would have', async () => {
    mockSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');

    render(<GlobalError error={error} retry={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('follows the system when nothing is saved', () => {
    mockSystemDark(true);

    render(<GlobalError error={error} retry={vi.fn()} />);

    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
