/**
 * @file Tests for the Mail server form on Settings' Integrations tab: what it
 * starts from, what it says about a saved password (which it never holds),
 * the sender locked by `EMAIL_FROM`, and what it sends.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';
import type { SmtpView } from '@/lib/smtp';

import renderInLocale from '../../../../../../tests/i18n/render';
import saveMailServerAction from './actions';
import MailServerForm from './mail-server-form';

vi.mock('./actions', () => ({ default: vi.fn() }));

afterEach(() => {
  vi.mocked(saveMailServerAction).mockReset();
});

/** A mail server saved in Settings, as the page gets it. */
const SAVED: SmtpView = {
  host: 'smtp.adiutor.test',
  port: 587,
  security: 'starttls',
  username: 'mailer@adiutor.test',
  hasPassword: true,
  from: { name: 'Adiutor Tests', address: 'no-reply@adiutor.test' },
};

describe('MailServerForm', () => {
  it('says no mail server is set up yet, and warns in production what that means', () => {
    const { unmount } = renderInLocale(
      'en-US',
      <MailServerForm current={null} environmentSender={null} production={false} />,
    );
    expect(screen.getByText('No mail server is set up yet.')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Security' })).toHaveTextContent('TLS');
    unmount();

    renderInLocale('en-US', <MailServerForm current={null} environmentSender={null} production />);
    expect(
      screen.getByText(
        'No mail server is set up yet: until one is, nobody gets sign-in links, password resets or invitations.',
      ),
    ).toBeVisible();
  });

  it('starts from the saved mail server, with its password left out and said to be kept', () => {
    renderInLocale(
      'en-US',
      <MailServerForm current={SAVED} environmentSender={null} production={false} />,
    );

    expect(screen.getByRole('textbox', { name: 'Server' })).toHaveValue('smtp.adiutor.test');
    expect(screen.getByRole('spinbutton', { name: 'Port' })).toHaveValue(587);
    expect(screen.getByRole('combobox', { name: 'Security' })).toHaveTextContent('STARTTLS');
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('mailer@adiutor.test');
    expect(screen.getByRole('textbox', { name: 'Sender name' })).toHaveValue('Adiutor Tests');
    expect(screen.getByRole('textbox', { name: 'Sender address' })).toHaveValue(
      'no-reply@adiutor.test',
    );
    const password = screen.getByLabelText('Password');
    expect(password).toHaveValue('');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(password).not.toBeRequired();
    expect(password).toHaveAccessibleDescription(
      'A password is saved. Leave this empty to keep it while the server, port and username stay the same.',
    );
    expect(
      screen.getByText(
        'Saving sends a test email to you through this server, then tells every staff Admin, you included.',
      ),
    ).toBeVisible();
  });

  it('locks the sender EMAIL_FROM chooses, and says why', () => {
    renderInLocale(
      'en-US',
      <MailServerForm
        current={SAVED}
        environmentSender="Adiutor <mail@adiutor.test>"
        production={false}
      />,
    );

    const sender = screen.getByRole('textbox', { name: 'Sender' });
    expect(sender).toBeDisabled();
    expect(sender).toHaveValue('Adiutor <mail@adiutor.test>');
    expect(sender).toHaveAccessibleDescription(
      "Chosen in the server's environment (EMAIL_FROM), so it can't be changed here.",
    );
    expect(screen.queryByRole('textbox', { name: 'Sender address' })).toBeNull();
  });

  it('sends what was typed, and empties the password once it’s saved', async () => {
    vi.mocked(saveMailServerAction).mockResolvedValue({ ok: true, message: 'Mail server saved.' });
    const user = userEvent.setup();
    renderInLocale(
      'en-US',
      <MailServerForm current={SAVED} environmentSender={null} production={false} />,
    );

    const password = screen.getByLabelText('Password');
    await user.type(password, 'a-new-password');
    await user.click(screen.getByRole('combobox', { name: 'Security' }));
    await user.click(screen.getByRole('option', { name: /^TLS/ }));
    await user.click(screen.getByRole('button', { name: 'Test and save' }));

    expect(await screen.findByText('Mail server saved.')).toBeInTheDocument();
    await waitFor(() => expect(password).toHaveValue(''));
    const formData = defined(vi.mocked(saveMailServerAction).mock.calls[0], 'the call')[1];
    expect(formData.get('host')).toBe('smtp.adiutor.test');
    expect(formData.get('security')).toBe('tls');
    expect(formData.get('password')).toBe('a-new-password');
    expect(formData.get('fromAddress')).toBe('no-reply@adiutor.test');
    // What isn't secret stays as it was saved.
    expect(screen.getByRole('textbox', { name: 'Server' })).toHaveValue('smtp.adiutor.test');
  });

  it('doesn’t send a sender while EMAIL_FROM chooses it', async () => {
    vi.mocked(saveMailServerAction).mockResolvedValue({ ok: true, message: 'Mail server saved.' });
    const user = userEvent.setup();
    renderInLocale(
      'en-US',
      <MailServerForm
        current={SAVED}
        environmentSender="Adiutor <mail@adiutor.test>"
        production={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Test and save' }));

    await waitFor(() => expect(saveMailServerAction).toHaveBeenCalledTimes(1));
    const formData = defined(vi.mocked(saveMailServerAction).mock.calls[0], 'the call')[1];
    expect(formData.has('fromAddress')).toBe(false);
    expect(formData.has('sender')).toBe(false);
  });
});
