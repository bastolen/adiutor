/**
 * @file End-to-end tests for the sign-in error page: Better Auth's errors end
 * there, it explains them without their code, and the reference it shows
 * leads an admin to the stored error.
 */

import { defined } from '../src/lib/defined';
import { findSignInError } from './support/db';
import { expect, test } from './support/test';

test('a failed sign-in ends on the error page, with a reference an admin can look up', async ({
  page,
}) => {
  await page.goto('/api/auth/error?error=state_mismatch&error_description=State%20mismatch');

  await expect(page).toHaveURL(/\/sign-in-error\?error=state_mismatch/);
  await expect(page.getByRole('heading', { name: "Signing in didn't work" })).toBeVisible();
  await expect(page.getByText(/took too long, or was started in another tab/)).toBeVisible();
  // The code itself isn't shown, only the reference.
  await expect(page.getByText('state_mismatch')).toHaveCount(0);
  const reference = page.getByText(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  await expect(reference).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy reference' })).toBeVisible();

  const shown = defined(await reference.textContent(), 'the reference');
  expect(await findSignInError(shown)).toEqual({
    code: 'state_mismatch',
    description: 'State mismatch',
  });

  await page.getByRole('link', { name: 'Sign in again' }).click();
  await expect(page).toHaveURL(/\/auth$/);
});

test('an unknown or missing code gets the general explanation', async ({ page }) => {
  await page.goto('/sign-in-error');

  await expect(page.getByText(/Something went wrong while signing you in/)).toBeVisible();
  await expect(page.getByText(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/)).toBeVisible();
});
