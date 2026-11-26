/**
 * @file Tests for what the Storage card shows while the server's environment
 * chooses where files are kept: its settings without a secret, or that
 * attachments are off, and the button that sets up a folder that isn't
 * Adiutor's yet.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import renderInLocale from '../../../../../../tests/i18n/render';
import { setUpStorageAction } from './actions';
import EnvironmentStorage from './environment-storage';

vi.mock('./actions', () => ({ setUpStorageAction: vi.fn() }));

/** A folder on the server the environment chose. */
const FOLDER = { driver: 'local', dir: '/data/attachments' } as const;

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

  it('offers to set up a folder that isn’t Adiutor’s yet, asking first', async () => {
    vi.mocked(setUpStorageAction).mockResolvedValue({ ok: true, message: 'Folder set up.' });
    const user = userEvent.setup();
    renderInLocale('en-US', <EnvironmentStorage view={FOLDER} setUp={false} />);

    expect(screen.getByText(/This folder isn’t set up as Adiutor’s yet/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Set up this folder' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Set up this folder?' });
    expect(dialog).toHaveTextContent('Do this only if it’s the right folder');
    await user.click(within(dialog).getByRole('button', { name: 'Set up folder' }));

    await waitFor(() => expect(setUpStorageAction).toHaveBeenCalledTimes(1));
  });

  it('offers nothing for a folder that is set up, or that couldn’t be checked', () => {
    const { unmount } = renderInLocale('en-US', <EnvironmentStorage view={FOLDER} setUp />);
    expect(screen.queryByRole('button', { name: 'Set up this folder' })).toBeNull();
    unmount();
    renderInLocale('en-US', <EnvironmentStorage view={FOLDER} setUp={null} />);
    expect(screen.queryByRole('button', { name: 'Set up this folder' })).toBeNull();
  });
});
