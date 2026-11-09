/**
 * @file Tests for the heading of the invitation and invite link pages: the
 * company and the role offered, named in the reader's language.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import InvitationHeading from './invitation-heading';
import renderInLocale from '../../../tests/i18n/render';

describe('InvitationHeading', () => {
  it('names the company and the role offered', () => {
    render(<InvitationHeading companyName="Adiutor Tests" roleId="client" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Join Adiutor Tests' })).toBeVisible();
    expect(
      screen.getByText("You've been invited to join Adiutor Tests on Adiutor as Client."),
    ).toBeInTheDocument();
  });

  it.each([
    [
      'nl-NL',
      'Word lid van Adiutor Tests',
      'Je bent uitgenodigd om lid te worden van Adiutor Tests op Adiutor, als Beheerder.',
    ],
    [
      'es-ES',
      'Únete a Adiutor Tests',
      'Te han invitado a unirte a Adiutor Tests en Adiutor como Administrador.',
    ],
  ] as const)('says it in %s, with the role in that language', (locale, heading, offer) => {
    renderInLocale(locale, <InvitationHeading companyName="Adiutor Tests" roleId="admin" />);

    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    expect(screen.getByText(offer)).toBeInTheDocument();
  });
});
