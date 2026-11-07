/**
 * @file Tests for a person's activity in the people tables: the Activity
 * column's content and the line under the name.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ActivityColumn, ActivityLine } from './activity';

/** When the test person joined. */
const JOINED = new Date('2026-10-28T09:00:00Z');

describe('ActivityColumn', () => {
  it('labels when they were last active for screen readers, with when they joined below', () => {
    const { container } = render(<ActivityColumn lastActiveAt={null} joinedAt={JOINED} />);

    expect(screen.getByText('Last active:')).toHaveClass('sr-only');
    expect(container).toHaveTextContent('Last active: Never');
    expect(screen.getByText('Joined 28 Oct 2026')).toHaveClass('block', 'text-xs');
  });

  it('gives the moment they were last active as a time', () => {
    const lastActive = new Date(Date.now() - 2 * 60 * 60_000);
    const { container } = render(<ActivityColumn lastActiveAt={lastActive} joinedAt={JOINED} />);

    expect(container.querySelector('time')).toHaveAttribute('datetime', lastActive.toISOString());
  });
});

describe('ActivityLine', () => {
  it('says when they were last active and joined, as two phrases', () => {
    const { container } = render(<ActivityLine lastActiveAt={null} joinedAt={JOINED} />);

    expect(screen.getByText(/^Last active/)).toHaveTextContent('Last active never');
    expect(screen.getByText('Joined 28 Oct 2026')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('contents');
  });

  it('takes the classes that hide it where the Activity column shows', () => {
    const { container } = render(
      <ActivityLine lastActiveAt={null} joinedAt={JOINED} className="xl:hidden" />,
    );

    expect(container.firstElementChild).toHaveClass('contents', 'xl:hidden');
  });
});
