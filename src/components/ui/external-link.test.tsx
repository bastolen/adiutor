/**
 * @file Tests for the link someone wrote in their own text.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ExternalLink from './external-link';

describe('ExternalLink', () => {
  it('opens in a new tab, says so, and gives the page it opens nothing about this one', () => {
    render(<ExternalLink href="https://adiutor.dev/docs">the docs</ExternalLink>);

    // The note is for screen readers only; jsdom drops the space before it from the name.
    const link = screen.getByRole('link', { name: /^the docs ?\(opens in a new tab\)$/ });
    expect(link.textContent).toBe('the docs (opens in a new tab)');
    expect(link).toHaveAttribute('href', 'https://adiutor.dev/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });
});
