/**
 * @file Tests for sending email over SMTP: what is sent, and that a mail
 * server that hangs can't hold a request or a job for long.
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';

import { sendEmail, sendFailureOf, SMTP_TIMEOUTS } from './email';

/**
 * Mocked SMTP transport and its factory, which keeps the options it was
 * created with (when the module loads, before the mocks' calls are cleared).
 */
const { sendMail, createTransport, transportOptions } = vi.hoisted(() => {
  const send = vi.fn();
  const options: unknown[] = [];
  return {
    sendMail: send,
    transportOptions: options,
    createTransport: vi.fn((created: unknown) => {
      options.push(created);
      return { sendMail: send };
    }),
  };
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

describe('the SMTP transport', () => {
  it('waits for the mail server well within the jobs’ tick, not nodemailer’s minutes', () => {
    expect(transportOptions).toEqual([
      expect.objectContaining({ url: 'smtp://localhost:1025', ...SMTP_TIMEOUTS }),
    ]);
    expect(Math.max(...Object.values(SMTP_TIMEOUTS))).toBeLessThan(45_000);
  });
});

describe('sendFailureOf', () => {
  it('keeps only the error code and the SMTP reply code, never the message', () => {
    const error = Object.assign(new Error('Recipient jane@adiutor.test rejected'), {
      code: 'EENVELOPE',
      responseCode: 550,
    });
    expect(sendFailureOf(error)).toEqual({ code: 'EENVELOPE', responseCode: 550 });
  });

  it('gives nulls for errors without codes and for values that are not errors', () => {
    expect(sendFailureOf(new Error('boom'))).toEqual({ code: null, responseCode: null });
    expect(sendFailureOf(undefined)).toEqual({ code: null, responseCode: null });
  });
});
