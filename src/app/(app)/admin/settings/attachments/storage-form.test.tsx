/**
 * @file Tests for the Storage form on Settings' Connections tab: the
 * drivers it offers, the fields of the one chosen, what it says about a
 * saved secret (which it never holds), what it sends, and the draft it keeps
 * when the page is shown again (on the way back from confirming it's you).
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import renderInLocale from '../../../../../../tests/i18n/render';
import Page from '../../../../../../tests/ui/page';
import { saveStorageAction } from './actions';
import StorageForm from './storage-form';

vi.mock('./actions', () => ({ saveStorageAction: vi.fn() }));

afterEach(() => {
  vi.mocked(saveStorageAction).mockReset();
});

/** A host key's fingerprint, as `ssh-keygen -lf` prints one. */
const HOST_KEY = 'SHA256:8Tn3u1YtizSXC8tJi132t6S2H2YZA9+pMADqWxgBdls';

describe('StorageForm', () => {
  it('says nothing is chosen yet, and offers a folder only off Vercel', async () => {
    const user = userEvent.setup();
    const { unmount } = renderInLocale('en-US', <StorageForm current={null} vercel={false} />);

    expect(screen.getByText('No storage is chosen yet, so nobody can attach files.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Test and save' })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Storage' }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('A folder on this server'),
      expect.stringContaining('An S3-compatible bucket'),
      expect.stringContaining('A folder on another server (SFTP)'),
    ]);
    unmount();

    renderInLocale('en-US', <StorageForm current={null} vercel />);
    await user.click(screen.getByRole('combobox', { name: 'Storage' }));
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.queryByRole('option', { name: /A folder on this server/ })).toBeNull();
  });

  it('starts from a saved SFTP server, with its secret left out and said to be kept', () => {
    renderInLocale(
      'en-US',
      <StorageForm
        current={{
          driver: 'sftp',
          host: 'files.adiutor.dev',
          port: 2222,
          username: 'adiutor',
          hostKey: HOST_KEY,
          dir: '/srv/adiutor',
          signsInWith: 'password',
        }}
        vercel={false}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Server' })).toHaveValue('files.adiutor.dev');
    expect(screen.getByRole('spinbutton', { name: 'Port' })).toHaveValue(2222);
    expect(screen.getByRole('textbox', { name: 'Host key fingerprint' })).toHaveValue(HOST_KEY);
    const password = screen.getByLabelText('Password');
    expect(password).toHaveValue('');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(password).toHaveAccessibleDescription(
      'A password is saved. Leave both empty to keep it while the server, port and user stay the same.',
    );
  });

  it('asks for a bucket’s secret unless one is saved', () => {
    const saved = {
      driver: 's3',
      endpoint: 'https://files.adiutor.dev',
      region: 'auto',
      bucket: 'adiutor',
      accessKeyId: 'key-id',
      forcePathStyle: true,
    } as const;
    const { unmount } = renderInLocale('en-US', <StorageForm current={saved} vercel={false} />);
    const secret = screen.getByLabelText('Secret access key');
    expect(secret).not.toBeRequired();
    expect(secret).toHaveAccessibleDescription(
      'A secret key is saved. Leave this empty to keep it while the service address and the access key stay the same.',
    );
    expect(screen.getByRole('checkbox', { name: 'Bucket in the path' })).toBeChecked();
    unmount();
  });

  it('empties a secret once it’s saved, as a saved one is never shown', async () => {
    vi.mocked(saveStorageAction).mockResolvedValue({ ok: true, message: 'Storage saved.' });
    const user = userEvent.setup();
    renderInLocale(
      'en-US',
      <StorageForm
        current={{
          driver: 's3',
          endpoint: 'https://files.adiutor.dev',
          region: 'auto',
          bucket: 'adiutor',
          accessKeyId: 'key-id',
          forcePathStyle: false,
        }}
        vercel={false}
      />,
    );

    const secret = screen.getByLabelText('Secret access key');
    await user.type(secret, 'a-new-secret');
    await user.click(screen.getByRole('button', { name: 'Test and save' }));

    expect(await screen.findByText('Storage saved.')).toBeInTheDocument();
    await waitFor(() => expect(secret).toHaveValue(''));
    const formData = defined(vi.mocked(saveStorageAction).mock.calls[0], 'the call')[1];
    expect(formData.get('secretAccessKey')).toBe('a-new-secret');
    // What isn't secret stays as it was saved.
    expect(screen.getByRole('textbox', { name: 'Bucket' })).toHaveValue('adiutor');
  });

  it('sends only the chosen driver’s fields', async () => {
    vi.mocked(saveStorageAction).mockResolvedValue({ ok: true, message: 'Storage saved.' });
    const user = userEvent.setup();
    renderInLocale('en-US', <StorageForm current={null} vercel={false} />);

    await user.click(screen.getByRole('combobox', { name: 'Storage' }));
    await user.click(screen.getByRole('option', { name: /A folder on this server/ }));
    await user.type(screen.getByRole('textbox', { name: 'Folder' }), '/data/attachments');
    await user.click(screen.getByRole('button', { name: 'Test and save' }));

    await waitFor(() => expect(saveStorageAction).toHaveBeenCalledTimes(1));
    const formData = defined(vi.mocked(saveStorageAction).mock.calls[0], 'the call')[1];
    expect(formData.get('driver')).toBe('local');
    expect(formData.get('dir')).toBe('/data/attachments');
    expect(formData.has('endpoint')).toBe(false);
    expect(await screen.findByText('Storage saved.')).toBeInTheDocument();
  });

  it('keeps the storage chosen and what was typed when the page is shown again', async () => {
    const user = userEvent.setup();
    renderInLocale(
      'en-US',
      <Page>
        <StorageForm current={null} vercel={false} />
      </Page>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Storage' }));
    await user.click(screen.getByRole('option', { name: /An S3-compatible bucket/ }));
    await user.type(screen.getByRole('textbox', { name: 'Bucket' }), 'adiutor');
    // Off to confirm it's you and back: the page was hidden, then shown again.
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(screen.getByRole('combobox', { name: 'Storage' })).toHaveTextContent(
      'An S3-compatible bucket',
    );
    expect(screen.getByRole('textbox', { name: 'Bucket' })).toHaveValue('adiutor');
  });

  it('keeps another storage than the saved one chosen when the page is shown again', async () => {
    const user = userEvent.setup();
    renderInLocale(
      'en-US',
      <Page>
        <StorageForm current={{ driver: 'local', dir: '/data/attachments' }} vercel={false} />
      </Page>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Storage' }));
    await user.click(screen.getByRole('option', { name: /A folder on another server/ }));
    await user.type(screen.getByRole('textbox', { name: 'Server' }), 'files.adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(screen.getByRole('combobox', { name: 'Storage' })).toHaveTextContent(
      'A folder on another server (SFTP)',
    );
    expect(screen.getByRole('textbox', { name: 'Server' })).toHaveValue('files.adiutor.test');
  });
});
