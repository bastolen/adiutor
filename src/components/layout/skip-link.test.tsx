/**
 * @file Tests for the "Skip to main content" link: it moves focus to the main
 * content without changing the address, and the main content is focusable
 * only while it has that focus.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import renderInLocale from '../../../tests/i18n/render';
import SkipLink from './skip-link';

describe('SkipLink', () => {
  it('moves focus to the main content and leaves the address as it is', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/dashboard');
    renderInLocale(
      'en-US',
      <>
        <SkipLink />
        <nav>
          <button type="button">Menu</button>
        </nav>
        <main id="main">
          <button type="button">Back to my account</button>
        </main>
      </>,
    );

    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus();
    await user.keyboard('{Enter}');

    const main = screen.getByRole('main');
    expect(main).toHaveFocus();
    expect(window.location.hash).toBe('');

    // Tab carries on inside the main content, which isn't focusable any more.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Back to my account' })).toHaveFocus();
    expect(main).not.toHaveAttribute('tabindex');
  });
});
