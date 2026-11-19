/**
 * @file Tests for the wrapper of a page that may use more of a wide screen.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import WidePage from './wide-page';

describe('WidePage', () => {
  it('holds the page, spaced like the app’s content, and grows only on a wide screen', () => {
    const { container } = render(
      <WidePage>
        <h1>A request</h1>
        <p>What was asked.</p>
      </WidePage>,
    );

    const page = container.firstElementChild;
    expect(page).toContainElement(screen.getByRole('heading', { level: 1, name: 'A request' }));
    expect(page).toHaveClass('flex', 'flex-col', 'gap-8');
    // Its wider margins only apply from the width at which the app's content stops growing.
    expect([...(page?.classList ?? [])].filter((name) => name.includes('mx-'))).toEqual([
      expect.stringMatching(/^xl:mx-\[calc\(/),
    ]);
  });
});
