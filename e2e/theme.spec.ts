/**
 * @file End-to-end tests for light and dark mode.
 */
import { expect, test } from '@playwright/test';

test('follows the system setting by default', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('a chosen theme is remembered and applied before the app loads', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  await page.getByRole('button', { name: 'Theme: System' }).click();
  await page.getByText('Light', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // Block the app's JavaScript, so only the inline script in <head> can set the theme.
  // If it's correct without React, it's correct from the first paint: no flash.
  await page.route('**/_next/static/**/*.js', (route) => route.abort());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
