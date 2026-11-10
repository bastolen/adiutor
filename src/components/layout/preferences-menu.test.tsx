/**
 * @file Tests for the theme and language button on the signed-out pages.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import setLanguageAction from '@/app/language-action';
import { THEME_STORAGE_KEY } from '@/lib/theme';

import renderInLocale from '../../../tests/i18n/render';
import PreferencesMenu from './preferences-menu';

vi.mock('@/app/language-action', () => ({ default: vi.fn(async () => true) }));

/** Stands in for `window.location.reload`, which jsdom can't do. */
const reload = vi.fn();

/** Finds a language's flag (`LanguageFlag`) by its 3:2 picture. */
const FLAG = 'svg[viewBox="0 0 30 20"]';

/** The button's name on a fresh page: the system theme, in English (US). */
const FRESH_NAME = 'Theme and language: System, English (US)';

/**
 * Gives the browser a language of its own, as choosing one in the menu does.
 *
 * @param locale - The language.
 */
function chooseInBrowser(locale: string) {
  document.cookie = `adiutor.locale=${locale}; path=/`;
}

beforeEach(() => {
  // The system setting is dark.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal('location', { ...window.location, reload });
});

afterEach(() => {
  document.cookie = 'adiutor.locale=; max-age=0; path=/';
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
  reload.mockClear();
  vi.mocked(setLanguageAction).mockClear();
});

describe('PreferencesMenu', () => {
  describe('the button', () => {
    it('shows two icons, the theme and the flag, and names both in full', () => {
      render(<PreferencesMenu />);

      const button = screen.getByRole('button', { name: FRESH_NAME });
      expect(button.textContent).toBe('');
      // The theme icon and the language's flag, hidden from screen readers.
      expect(button.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
      expect(button.querySelector(FLAG)).not.toBeNull();
    });

    it("speaks the reader's language", async () => {
      const user = userEvent.setup();
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      renderInLocale('es-ES', <PreferencesMenu />);

      const button = screen.getByRole('button', { name: 'Tema e idioma: Oscuro, Español' });
      await user.click(button);

      expect(screen.getByRole('group', { name: 'Tema' })).toBeInTheDocument();
      expect(screen.getByRole('menuitemradio', { name: 'Claro' })).toBeInTheDocument();
      expect(screen.getByText('Idioma')).toBeInTheDocument();
    });

    it('works with the keyboard and returns focus to itself', async () => {
      const user = userEvent.setup();
      render(<PreferencesMenu />);
      const button = screen.getByRole('button', { name: FRESH_NAME });

      button.focus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('menu')).toBeInTheDocument();
      await user.keyboard('{Escape}');

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    });
  });

  describe('the theme', () => {
    it('catches up with a system change made while the page was loading', () => {
      // The inline script chose light, then the system switched to dark (the stub) before hydration.
      document.documentElement.dataset.theme = 'light';
      render(<PreferencesMenu />);

      expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('keeps a chosen theme when it takes over the server-rendered page', async () => {
      // The server rendered "System"; the inline script already applied the stored choice.
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      document.documentElement.dataset.theme = 'light';
      const container = document.createElement('div');
      container.innerHTML = renderToString(<PreferencesMenu />);
      document.body.append(container);

      render(<PreferencesMenu />, { container, hydrate: true });

      expect(
        await screen.findByRole('button', { name: 'Theme and language: Light, English (US)' }),
      ).toBeInTheDocument();
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('starts on the system preference', async () => {
      const user = userEvent.setup();
      render(<PreferencesMenu />);

      await user.click(screen.getByRole('button', { name: FRESH_NAME }));

      expect(screen.getByRole('menuitemradio', { name: 'System' })).toBeChecked();
    });

    it('stores and applies a choice, keeping the menu open', async () => {
      const user = userEvent.setup();
      render(<PreferencesMenu />);

      await user.click(screen.getByRole('button', { name: FRESH_NAME }));
      await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));

      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(screen.getByRole('menuitemradio', { name: 'Light' })).toBeChecked();
      // The menu hides the rest of the page from screen readers while it's open.
      await user.keyboard('{Escape}');
      expect(
        screen.getByRole('button', { name: 'Theme and language: Light, English (US)' }),
      ).toBeInTheDocument();
    });

    it('goes back to following the system', async () => {
      const user = userEvent.setup();
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      render(<PreferencesMenu />);

      await user.click(
        screen.getByRole('button', { name: 'Theme and language: Light, English (US)' }),
      );
      await user.click(screen.getByRole('menuitemradio', { name: 'System' }));

      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
  });

  describe('the language', () => {
    it('lists each language in itself, the browser’s choice checked', async () => {
      chooseInBrowser('nl-NL');
      const user = userEvent.setup();
      renderInLocale('nl-NL', <PreferencesMenu />);

      await user.click(screen.getByRole('button', { name: 'Thema en taal: Systeem, Nederlands' }));

      expect(screen.getByRole('menuitemradio', { name: 'Nederlands' })).toBeChecked();
      expect(
        screen.getByRole('menuitemradio', { name: 'Español' }).querySelector('svg[aria-hidden]'),
      ).not.toBeNull();
      expect(screen.getByText('English (US)')).toHaveAttribute('lang', 'en-US');
      expect(screen.getByText('Español')).toHaveAttribute('lang', 'es-ES');
    });

    it('ticks Default, first, while the browser has no language of its own', async () => {
      const user = userEvent.setup();
      render(<PreferencesMenu />);

      await user.click(screen.getByRole('button', { name: FRESH_NAME }));

      const languages = screen.getAllByRole('menuitemradio').slice(3);
      expect(languages.map((item) => item.textContent)).toEqual([
        'Default',
        'English (US)',
        'Nederlands',
        'Español',
      ]);
      expect(screen.getByRole('menuitemradio', { name: 'Default' })).toBeChecked();
      expect(screen.getByRole('menuitemradio', { name: 'English (US)' })).not.toBeChecked();
    });

    it('goes back to Adiutor’s default language and reloads the page in it', async () => {
      chooseInBrowser('es-ES');
      const user = userEvent.setup();
      renderInLocale('es-ES', <PreferencesMenu />);

      await user.click(screen.getByRole('button', { name: 'Tema e idioma: Sistema, Español' }));
      await user.click(screen.getByRole('menuitemradio', { name: 'Predeterminado' }));

      await waitFor(() => expect(reload).toHaveBeenCalled());
      expect(setLanguageAction).toHaveBeenCalledWith('default');
    });

    it('remembers another language and reloads the page in it', async () => {
      const user = userEvent.setup();
      render(<PreferencesMenu />);

      await user.click(screen.getByRole('button', { name: FRESH_NAME }));
      await user.click(screen.getByRole('menuitemradio', { name: 'Español' }));

      await waitFor(() => expect(reload).toHaveBeenCalled());
      expect(setLanguageAction).toHaveBeenCalledWith('es-ES');
    });

    it('is busy while the language changes', async () => {
      // Never settles, as if the page were still reloading.
      vi.mocked(setLanguageAction).mockReturnValueOnce(new Promise(() => {}));
      const user = userEvent.setup();
      render(<PreferencesMenu />);

      await user.click(screen.getByRole('button', { name: FRESH_NAME }));
      await user.click(screen.getByRole('menuitemradio', { name: 'Nederlands' }));

      await waitFor(() =>
        expect(screen.getByRole('button', { name: FRESH_NAME })).toHaveAttribute(
          'aria-busy',
          'true',
        ),
      );
      // The spinner takes the flag's place until the page has reloaded.
      const button = screen.getByRole('button', { name: FRESH_NAME });
      expect(button.querySelector('.animate-spin')).not.toBeNull();
      expect(button.querySelector(FLAG)).toBeNull();
    });

    it('does nothing when the browser’s choice is chosen again', async () => {
      chooseInBrowser('en-US');
      const user = userEvent.setup();
      render(<PreferencesMenu />);

      await user.click(screen.getByRole('button', { name: FRESH_NAME }));
      await user.click(screen.getByRole('menuitemradio', { name: 'English (US)' }));

      expect(setLanguageAction).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });

    it('does nothing when Default is chosen again', async () => {
      const user = userEvent.setup();
      render(<PreferencesMenu />);

      await user.click(screen.getByRole('button', { name: FRESH_NAME }));
      await user.click(screen.getByRole('menuitemradio', { name: 'Default' }));

      expect(setLanguageAction).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });

    it('on Default, keeps the language it shows as the browser’s own when it is chosen', async () => {
      const user = userEvent.setup();
      render(<PreferencesMenu />);

      await user.click(screen.getByRole('button', { name: FRESH_NAME }));
      await user.click(screen.getByRole('menuitemradio', { name: 'English (US)' }));

      await waitFor(() => expect(reload).toHaveBeenCalled());
      expect(setLanguageAction).toHaveBeenCalledWith('en-US');
    });
  });
});
