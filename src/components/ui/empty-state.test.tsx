/**
 * @file Tests for the empty state: its title element, and the ref that lets
 * a page move focus to the title, and the content below the action.
 */
import { render, screen } from '@testing-library/react';
import { SearchX } from 'lucide-react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import EmptyState from './empty-state';

describe('EmptyState', () => {
  it('shows the title in the element asked for, out of reach of focus by default', () => {
    render(<EmptyState icon={SearchX} title="Page not found" titleAs="h1" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).not.toHaveAttribute(
      'tabindex',
    );
  });

  it('lets a page focus the title through its ref, without putting it in the tab order', () => {
    const titleRef = createRef<HTMLElement>();
    render(
      <EmptyState icon={SearchX} title="Something went wrong" titleAs="h1" titleRef={titleRef} />,
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'Something went wrong' });
    expect(titleRef.current).toBe(heading);
    expect(heading).toHaveAttribute('tabindex', '-1');
    titleRef.current?.focus();
    expect(heading).toHaveFocus();
  });

  it('shows more content below the action', () => {
    render(
      <EmptyState
        icon={SearchX}
        title="Something went wrong"
        action={<button type="button">Try again</button>}
      >
        <p>Reference 7KQ2-M9XD</p>
      </EmptyState>,
    );

    const action = screen.getByRole('button', { name: 'Try again' });
    const more = screen.getByText('Reference 7KQ2-M9XD');
    // eslint-disable-next-line no-bitwise -- `compareDocumentPosition` returns a bit mask.
    expect(action.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
