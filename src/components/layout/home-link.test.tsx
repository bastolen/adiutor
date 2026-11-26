/**
 * @file Tests for the logo link to the home page: it's named after the staff
 * for screen readers, in the reader's language.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StaffNameProvider } from '@/components/brand/staff-name';

import renderInLocale from '../../../tests/i18n/render';
import HomeLink from './home-link';

describe('HomeLink', () => {
  it('links home, named after Adiutor until the staff have a name of their own', () => {
    render(<HomeLink className="">Logo</HomeLink>);

    expect(screen.getByRole('link', { name: 'Adiutor home' })).toHaveAttribute('href', '/');
  });

  it.each([
    ['en-US', 'Adiutor Tests Support home'],
    ['nl-NL', 'Startpagina van Adiutor Tests Support'],
    ['es-ES', 'Inicio de Adiutor Tests Support'],
  ] as const)('names the staff in %s', (locale, name) => {
    renderInLocale(
      locale,
      <StaffNameProvider name="Adiutor Tests Support">
        <HomeLink className="">Logo</HomeLink>
      </StaffNameProvider>,
    );

    expect(screen.getByRole('link', { name })).toHaveAttribute('href', '/');
  });
});
