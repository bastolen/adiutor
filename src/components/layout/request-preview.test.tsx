/**
 * @file Tests for the example request on the brand panel of the public
 * pages: its conversation in the reader's language, with the weekdays from
 * `Intl`, the staff answering under their own name, and the avatars'
 * initials from the names.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StaffNameProvider } from '@/components/brand/staff-name';

import renderInLocale from '../../../tests/i18n/render';
import RequestPreview from './request-preview';

describe('RequestPreview', () => {
  it('shows a company user asking and the staff answering, in English (US)', () => {
    render(<RequestPreview />);

    expect(screen.getByText('Update the opening hours on the website')).toBeInTheDocument();
    expect(screen.getByText('Waiting for your approval')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Adiutor')).toBeInTheDocument();
    expect(screen.getByText('· Mon', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('· Tue', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Y')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('AD')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    ['nl-NL', 'Jij', 'J', 'ma', 'Goedkeuren'],
    ['es-ES', 'Tú', 'T', 'lun', 'Aprobar'],
  ] as const)(
    'speaks %s, with its own weekdays and initials, and the staff’s name',
    (locale, you, youInitial, monday, approve) => {
      renderInLocale(
        locale,
        <StaffNameProvider name="Adiutor Tests Support">
          <RequestPreview />
        </StaffNameProvider>,
      );

      expect(screen.getByText(you)).toBeInTheDocument();
      expect(screen.getByText(youInitial)).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByText('Adiutor Tests Support')).toBeInTheDocument();
      expect(screen.getByText('AT')).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByText(`· ${monday}`, { exact: false })).toBeInTheDocument();
      expect(screen.getByText(approve)).toBeInTheDocument();
    },
  );
});
