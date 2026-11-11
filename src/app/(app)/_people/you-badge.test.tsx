/**
 * @file Tests for the "You" badge on the viewer's own row in tables of people.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import renderInLocale from '../../../../tests/i18n/render';
import YouBadge from './you-badge';

describe('YouBadge', () => {
  it('says "You" in the accent tone', () => {
    render(<YouBadge />);

    expect(screen.getByText('You')).toHaveClass('border-highlight', 'text-highlight');
  });

  it('says "Jij" in Dutch', () => {
    renderInLocale('nl-NL', <YouBadge />);
    expect(screen.getByText('Jij')).toBeInTheDocument();
  });

  it('says "Tú" in Spanish', () => {
    renderInLocale('es-ES', <YouBadge />);
    expect(screen.getByText('Tú')).toBeInTheDocument();
  });
});
