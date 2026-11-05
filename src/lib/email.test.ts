/**
 * @file Tests for sending email over SMTP: a pooled transport, and what is
 * sent.
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';

import { sendEmail, SMTP_MAX_CONNECTIONS } from './email';

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
  it('reuses a few pooled SMTP connections, letting the URL override them', async () => {
    // The transport is created when the module loads, so load it afresh.
    vi.resetModules();
    createTransport.mockClear();
    await import('./email');

    expect(createTransport).toHaveBeenCalledOnce();
    expect(createTransport).toHaveBeenCalledWith({
      url: 'smtp://localhost:1025',
      pool: true,
      maxConnections: SMTP_MAX_CONNECTIONS,
    });
    expect(SMTP_MAX_CONNECTIONS).toBe(3);
  });

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
