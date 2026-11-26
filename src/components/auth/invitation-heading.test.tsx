/**
 * @file Tests for the heading of the invitation and invite link pages: the
 * company and the role offered, named in the reader's language, with the
 * staff's name, which an invitation to the staff names only once.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import renderInLocale from '../../../tests/i18n/render';
import InvitationHeading from './invitation-heading';

describe('InvitationHeading', () => {
  it('names the company, the staff and the role offered', () => {
    render(
      <InvitationHeading
        companyName="Adiutor Tests"
        target="company"
        staffName="Adiutor"
        roleId="client"
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Join Adiutor Tests' })).toBeVisible();
    expect(
      screen.getByText("You've been invited to join Adiutor Tests on Adiutor as Client."),
    ).toBeInTheDocument();
  });

  it('names the staff once when the invitation is to the staff', () => {
    render(
      <InvitationHeading
        companyName="Adiutor Tests Support"
        target="staff"
        staffName="Adiutor Tests Support"
        roleId="support"
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Join Adiutor Tests Support' }),
    ).toBeVisible();
    expect(
      screen.getByText("You've been invited to join Adiutor Tests Support as Support."),
    ).toBeInTheDocument();
  });

  it.each([
    [
      'nl-NL',
      'Word lid van Adiutor Tests',
      'Je bent uitgenodigd om lid te worden van Adiutor Tests bij Adiutor Tests Support, als Beheerder.',
      'Je bent uitgenodigd om lid te worden van Adiutor Tests Support, als Beheerder.',
    ],
    [
      'es-ES',
      'Únete a Adiutor Tests',
      'Te han invitado a unirte a Adiutor Tests en Adiutor Tests Support como Administrador.',
      'Te han invitado a unirte a Adiutor Tests Support como Administrador.',
    ],
  ] as const)(
    'says it in %s, with the role in that language',
    (locale, heading, toCompany, toStaff) => {
      const { unmount } = renderInLocale(
        locale,
        <InvitationHeading
          companyName="Adiutor Tests"
          target="company"
          staffName="Adiutor Tests Support"
          roleId="admin"
        />,
      );

      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      expect(screen.getByText(toCompany)).toBeInTheDocument();
      unmount();

      renderInLocale(
        locale,
        <InvitationHeading
          companyName="Adiutor Tests Support"
          target="staff"
          staffName="Adiutor Tests Support"
          roleId="platform_admin"
        />,
      );
      expect(screen.getByText(toStaff)).toBeInTheDocument();
    },
  );
});
