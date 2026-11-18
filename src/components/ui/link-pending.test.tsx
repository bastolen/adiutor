/**
 * @file Tests for the link pending indicator: it shows the icon while the
 * link's page isn't loading, and a spinner in its place (without moving
 * anything) while it is, leaving a wrapped label as the link's name.
 */
import { render, screen } from '@testing-library/react';
import Link, { useLinkStatus } from 'next/link';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LinkPendingIndicator from './link-pending';

vi.mock('next/link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/link')>()),
  useLinkStatus: vi.fn(() => ({ pending: false })),
}));

/**
 * Renders the indicator inside a link, like the pagination does.
 *
 * @returns The link.
 */
function IndicatorLink() {
  return (
    <Link href="/members?page=2">
      Next
      <LinkPendingIndicator>
        <svg data-testid="icon" aria-hidden="true" />
      </LinkPendingIndicator>
    </Link>
  );
}

/**
 * Renders a link whose whole label is inside the indicator, like the
 * segmented filter links do.
 *
 * @returns The link.
 */
function LabelLink() {
  return (
    <Link href="/users?status=deactivated">
      <LinkPendingIndicator>Deactivated</LinkPendingIndicator>
    </Link>
  );
}

/**
 * The spinner, if one is shown: an `svg` that spins.
 *
 * @param container - Where to look.
 * @returns The spinner, or `null`.
 */
function spinnerIn(container: HTMLElement) {
  return container.querySelector('svg.animate-spin');
}

describe('LinkPendingIndicator', () => {
  beforeEach(() => {
    vi.mocked(useLinkStatus).mockReturnValue({ pending: false });
  });

  describe('when the link is not pending', () => {
    it('shows its children', () => {
      render(<IndicatorLink />);

      expect(screen.getByTestId('icon')).toBeVisible();
    });

    it('is not busy and shows no spinner', () => {
      const { container } = render(<IndicatorLink />);

      expect(container.querySelector('[aria-busy]')).not.toBeInTheDocument();
      expect(spinnerIn(container)).not.toBeInTheDocument();
    });

    it('does not hide its children', () => {
      render(<IndicatorLink />);

      expect(screen.getByTestId('icon').parentElement).not.toHaveClass('opacity-0');
    });
  });

  describe('when the link is pending', () => {
    beforeEach(() => {
      vi.mocked(useLinkStatus).mockReturnValue({ pending: true });
    });

    it('is busy', () => {
      const { container } = render(<IndicatorLink />);

      const busy = container.querySelectorAll('[aria-busy="true"]');
      expect(busy).toHaveLength(1);
      expect(busy[0]).toContainElement(screen.getByTestId('icon'));
    });

    it('keeps the children in place but transparent, so nothing moves', () => {
      render(<IndicatorLink />);

      const icon = screen.getByTestId('icon');
      expect(icon).toBeInTheDocument();
      expect(icon.parentElement).toHaveClass('opacity-0');
    });

    it('never hides the children from assistive technology', () => {
      render(<IndicatorLink />);

      // `visibility: hidden` would take a wrapped label out of the accessibility tree.
      expect(screen.getByTestId('icon').parentElement).not.toHaveClass('invisible');
      expect(screen.getByTestId('icon').parentElement).not.toHaveClass('hidden');
    });

    it('keeps the name of a link whose label it wraps', () => {
      render(<LabelLink />);

      const link = screen.getByRole('link', { name: 'Deactivated' });
      expect(link.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(screen.getByText('Deactivated')).toHaveClass('opacity-0');
    });

    it('shows a spinner over them', () => {
      const { container } = render(<IndicatorLink />);

      const spinner = spinnerIn(container);
      expect(spinner).toBeInTheDocument();
      expect(spinner).toHaveAttribute('aria-hidden', 'true');
      expect(spinner).toHaveClass('absolute');
    });

    it('leaves the link name alone', () => {
      render(<IndicatorLink />);

      expect(screen.getByRole('link', { name: 'Next' })).toBeInTheDocument();
    });
  });
});
