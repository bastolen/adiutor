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

// The language button's action reads the server's configuration; nothing here changes the language.
vi.mock('./language-action', () => ({ default: vi.fn(async () => true) }));

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
  it('renders a whole document with its title, the shipped fonts and the error page', () => {
    const html = renderToStaticMarkup(<GlobalError error={error} retry={vi.fn()} />);

    // The fonts' variables (Inter and JetBrains Mono, `src/lib/fonts.ts`), as the root layout has.
    expect(html).toMatch(/^<html lang="en-US" class="font-inter font-jetbrains-mono">/);
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

describe('GlobalError in another language', () => {
  afterEach(() => {
    document.cookie = 'adiutor.locale=; max-age=0';
  });

  it("switches to the language cookie's language once it's in the browser", async () => {
    mockSystemDark(false);
    document.cookie = 'adiutor.locale=nl-NL';

    render(<GlobalError error={error} retry={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Er ging iets mis' })).toBeVisible();
    expect(document.documentElement).toHaveAttribute('lang', 'nl-NL');
  });
});
