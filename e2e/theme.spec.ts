/**
 * @file End-to-end tests for light and dark mode: the floating theme button
 * on the public pages and the theme row in the account menu.
 */
import { type Page } from '@playwright/test';

import { PLATFORM_ADMIN } from './support/fixtures';
import { signIn, useOwnClientIp } from './support/helpers';
import { expect, test } from './support/test';
import { THEME_STORAGE_KEY } from '../src/lib/theme';

/** The semantic colour tokens of `src/styles/theme.css`. */
const TOKENS = [
  'background',
  'surface',
  'muted',
  'border',
  'border-strong',
  'foreground',
  'muted-foreground',
  'primary',
  'primary-hover',
  'primary-foreground',
  'highlight',
  'ring',
  'danger',
  'danger-hover',
  'danger-foreground',
  'danger-soft',
  'success',
  'success-soft',
  'warning',
  'warning-soft',
];

/**
 * Reads the colour each semantic token resolves to, with a theme set on
 * `<html>` or, as before the app's script runs, without one.
 *
 * @param page - The page.
 * @param theme - The `data-theme` to set, or `null` to remove it.
 * @returns The page's colour scheme, and each token's colour.
 */
async function tokenColours(
  page: Page,
  theme: 'light' | 'dark' | null,
): Promise<{ colorScheme: string; colours: Record<string, string> }> {
  return page.evaluate(
    ({ tokens, chosen }) => {
      const root = document.documentElement;
      if (chosen) {
        root.setAttribute('data-theme', chosen);
      } else {
        root.removeAttribute('data-theme');
      }
      const probe = document.createElement('span');
      document.body.append(probe);
      const colours: Record<string, string> = {};
      tokens.forEach((token) => {
        probe.style.color = `var(--${token})`;
        colours[token] = getComputedStyle(probe).color;
      });
      probe.remove();
      return { colorScheme: getComputedStyle(root).colorScheme, colours };
    },
    { tokens: TOKENS, chosen: theme },
  );
}

test('follows the system setting by default', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/auth');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('a chosen theme is remembered and applied before the app loads', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/auth');

  await page.getByRole('button', { name: 'Theme: System' }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // After a reload, the app takes over the page without switching back to the system's theme.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // Block the app's JavaScript, so only the inline script in <head> can set the theme.
  // If it's correct without React, it's correct from the first paint: no flash.
  await page.route('**/_next/static/**/*.js', (route) => route.abort());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('a chosen theme wins over the system setting, which applies without one', async ({ page }) => {
  await page.goto('/auth');
  await page.emulateMedia({ colorScheme: 'dark' });
  const light = await tokenColours(page, 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  const dark = await tokenColours(page, 'dark');

  expect(light.colorScheme).toBe('light');
  expect(dark.colorScheme).toBe('dark');
  TOKENS.forEach((token) => expect(dark.colours[token], token).not.toBe(light.colours[token]));

  // Without a theme on <html> (e.g. without JavaScript), the system setting picks the same colours.
  await page.emulateMedia({ colorScheme: 'dark' });
  expect((await tokenColours(page, null)).colours).toEqual(dark.colours);
  await page.emulateMedia({ colorScheme: 'light' });
  expect((await tokenColours(page, null)).colours).toEqual(light.colours);
});

test('signed in, the theme is chosen in the account menu, sharing the choice with sign-in', async ({
  page,
}) => {
  await useOwnClientIp(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Theme: System' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();

  await signIn(page, PLATFORM_ADMIN);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  // Signed in, the account menu takes the floating button's place.
  await expect(page.getByRole('button', { name: /^Theme:/ })).toHaveCount(0);

  const accountMenu = page.getByRole('button', { name: /^Account menu/ });
  await accountMenu.click();
  const theme = page.getByRole('group', { name: 'Theme' });
  await expect(theme.getByRole('menuitemradio', { name: 'Dark' })).toBeChecked();

  // Choosing keeps the menu open, so the new theme shows at once.
  await theme.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(theme.getByRole('menuitemradio', { name: 'Light' })).toBeChecked();
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await accountMenu.click();
  await expect(theme.getByRole('menuitemradio', { name: 'Light' })).toBeChecked();

  // Back on System, the theme follows the system again, even with the menu closed.
  await theme.getByRole('menuitemradio', { name: 'System' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBeNull();
});
