/**
 * @file Tests for what the Storage card shows while the server's environment
 * chooses where files are kept: its settings without a secret, or that
 * attachments are off.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import renderInLocale from '../../../../../../tests/i18n/render';
import EnvironmentStorage from './environment-storage';

describe('EnvironmentStorage', () => {
  it('shows an SFTP server the environment chose, without its password', () => {
    renderInLocale(
      'en-US',
      <EnvironmentStorage
        view={{
          driver: 'sftp',
          host: 'files.adiutor.dev',
          port: 22,
          username: 'adiutor',
          hostKey: 'SHA256:8Tn3u1YtizSXC8tJi132t6S2H2YZA9+pMADqWxgBdls',
          dir: '/srv/adiutor',
          signsInWith: 'key',
        }}
      />,
    );

    expect(
      screen.getByText(
        "Chosen in the server's environment (ATTACHMENTS_STORAGE), so it can't be changed here.",
      ),
    ).toBeVisible();
    expect(screen.getByText('A folder on another server (SFTP)')).toBeVisible();
    expect(screen.getByText('files.adiutor.dev')).toBeVisible();
    expect(screen.getByText('A private key')).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says attachments are off when the environment turned them off', () => {
    renderInLocale('en-US', <EnvironmentStorage view={null} />);
    expect(
      screen.getByText(
        "Attachments are turned off in the server's environment (ATTACHMENTS_STORAGE=off).",
      ),
    ).toBeVisible();
  });
});
