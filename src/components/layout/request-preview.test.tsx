/**
 * @file Tests for the example request on the brand panel of the public
 * pages: its conversation in the reader's language, with the weekdays from
 * `Intl` and the avatars' initials from the names.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import RequestPreview from './request-preview';
import renderInLocale from '../../../tests/i18n/render';

describe('RequestPreview', () => {
  it('shows a company user asking and the staff answering, in English (US)', () => {
    render(<RequestPreview />);

    expect(screen.getByText('Update the opening hours on the website')).toBeInTheDocument();
    expect(screen.getByText('Waiting for your approval')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Adiutor Support')).toBeInTheDocument();
    expect(screen.getByText('· Mon', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('· Tue', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Y')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('AS')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    ['nl-NL', 'Jij', 'J', 'Adiutor Support', 'AS', 'ma', 'Goedkeuren'],
    ['es-ES', 'Tú', 'T', 'Soporte Adiutor', 'SA', 'lun', 'Aprobar'],
  ] as const)(
    'speaks %s, with its own weekdays and initials',
    (locale, you, youInitial, staff, staffInitials, monday, approve) => {
      renderInLocale(locale, <RequestPreview />);

      expect(screen.getByText(you)).toBeInTheDocument();
      expect(screen.getByText(youInitial)).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByText(staff)).toBeInTheDocument();
      expect(screen.getByText(staffInitials)).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByText(`· ${monday}`, { exact: false })).toBeInTheDocument();
      expect(screen.getByText(approve)).toBeInTheDocument();
    },
  );
});
