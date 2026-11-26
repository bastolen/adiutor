/**
 * @file Tests for what the Mail server card shows while the server's
 * environment chooses the mail server: its settings without a password, and
 * the sender, or that its address can't be read.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import renderInLocale from '../../../../../../tests/i18n/render';
import EnvironmentMailServer from './environment-mail-server';

describe('EnvironmentMailServer', () => {
  it('shows the mail server SMTP_URL names and the sender, never a password', () => {
    renderInLocale(
      'en-US',
      <EnvironmentMailServer
        view={{
          host: 'smtp.adiutor.test',
          port: 465,
          security: 'tls',
          username: 'mailer@adiutor.test',
          hasPassword: true,
        }}
        sender="Adiutor <no-reply@adiutor.test>"
      />,
    );

    expect(
      screen.getByText(
        "Chosen in the server's environment (SMTP_URL), so it can't be changed here.",
      ),
    ).toBeVisible();
    expect(screen.getByText('smtp.adiutor.test')).toBeVisible();
    expect(screen.getByText('465')).toBeVisible();
    expect(screen.getByText('TLS')).toBeVisible();
    expect(screen.getByText('mailer@adiutor.test')).toBeVisible();
    expect(screen.getByText('Adiutor <no-reply@adiutor.test>')).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says it signs in to no server without a username', () => {
    renderInLocale(
      'en-US',
      <EnvironmentMailServer
        view={{
          host: 'localhost',
          port: 1025,
          security: 'none',
          username: null,
          hasPassword: false,
        }}
        sender="Adiutor <no-reply@adiutor.dev>"
      />,
    );

    expect(screen.getByText('Without signing in')).toBeVisible();
    expect(screen.getByText('None')).toBeVisible();
  });

  it('says so when the environment’s address can’t be read', () => {
    renderInLocale('en-US', <EnvironmentMailServer view={null} sender="Adiutor" />);

    expect(
      screen.getByText(
        "The server's environment chooses the mail server, but its address can't be read.",
      ),
    ).toBeVisible();
  });
});
