/**
 * @file Tests for the relative time: the `<time>` element with the exact
 * moment as its tooltip, and the exact moment for screen readers when asked.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatDateTime } from '@/lib/format';

import renderInLocale from '../../../tests/i18n/render';
import RelativeTime from './relative-time';

/** A moment long ago, so the wording is a date and the test never goes stale. */
const LONG_AGO = new Date('2020-03-04T10:15:00Z');

describe('RelativeTime', () => {
  it('shows a time element with the exact moment as its tooltip', () => {
    const { container } = render(<RelativeTime date={LONG_AGO} />);

    const time = container.querySelector('time');
    expect(time).toHaveAttribute('datetime', LONG_AGO.toISOString());
    expect(time).toHaveAttribute('title', formatDateTime(LONG_AGO, 'en-US', 'UTC'));
    expect(container.querySelector('.sr-only')).toBeNull();
  });

  it('adds the exact moment for screen readers right after the time when asked', () => {
    const { container } = render(<RelativeTime date={LONG_AGO} spokenExact />);

    const time = container.querySelector('time');
    const spoken = container.querySelector('span.sr-only');
    expect(spoken).toHaveTextContent(`, ${formatDateTime(LONG_AGO, 'en-US', 'UTC')}`);
    expect(time?.nextElementSibling).toBe(spoken);
  });

  it("gives the exact moment in the reader's zone", () => {
    const { container } = renderInLocale('en-US', <RelativeTime date={LONG_AGO} />, 'Asia/Kolkata');

    expect(container.querySelector('time')).toHaveAttribute('title', 'Mar 4, 2020, 3:45 PM');
  });

  it('says never for no date, with nothing added for screen readers', () => {
    const { container } = render(<RelativeTime date={null} spokenExact />);

    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(container.querySelector('time')).toBeNull();
    expect(container.querySelector('.sr-only')).toBeNull();
  });
});
