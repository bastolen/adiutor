/**
 * @file Tests for the link that covers a table row.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import RowLink from './row-link';

describe('RowLink', () => {
  it('is a link to its destination, named by its content', () => {
    render(<RowLink href="/companies/adiutor-tests">Adiutor Tests</RowLink>);

    expect(screen.getByRole('link', { name: 'Adiutor Tests' })).toHaveAttribute(
      'href',
      '/companies/adiutor-tests',
    );
  });

  it('stretches over its row and shows focus', () => {
    render(<RowLink href="/requests/1">Printer</RowLink>);

    const link = screen.getByRole('link');
    expect(link).toHaveClass('after:absolute', 'after:inset-0', 'group-hover:underline');
    expect(link.className).toContain('focus-visible');
  });
});
