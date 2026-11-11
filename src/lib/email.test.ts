/**
 * @file Tests for sending email over SMTP: what is sent.
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';

import { sendEmail } from './email';

/** Mocked SMTP transport and its factory. */
const { sendMail, createTransport } = vi.hoisted(() => {
  const send = vi.fn();
  return { sendMail: send, createTransport: vi.fn((_options: unknown) => ({ sendMail: send })) };
});

vi.mock('nodemailer', () => ({ createTransport }));

vi.mock('./env', () => ({
  env: {
    NODE_ENV: 'test',
    SMTP_URL: 'smtp://localhost:1025',
    EMAIL_FROM: 'Adiutor <no-reply@adiutor.test>',
    EMAIL_OUTBOX_DIR: undefined,
  },
}));

describe('sendEmail', () => {
  it('sends the HTML and plain-text versions over SMTP, without attachments', async () => {
    await sendEmail({
      to: 'jane@adiutor.test',
      subject: 'Your Adiutor sign-in link',
      text: 'Sign in https://adiutor.test/x',
      html: '<p>Sign in</p>',
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: 'Adiutor <no-reply@adiutor.test>',
      to: 'jane@adiutor.test',
      subject: 'Your Adiutor sign-in link',
      text: 'Sign in https://adiutor.test/x',
      html: '<p>Sign in</p>',
    });
  });
});
