/**
 * @file Tests for sending email over SMTP: what is sent, and that a mail
 * server that hangs can't hold a request or a job for long.
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Email, sendEmail, sendFailureOf, SMTP_TIMEOUTS } from './email';
import { SEND_TIMEOUT_MS } from './email-limits';

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
      return { sendMail: send, close: vi.fn() };
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

/** An email to send in the tests. */
const email: Email = {
  to: 'jane@adiutor.test',
  subject: 'Your Adiutor sign-in link',
  text: 'Sign in https://adiutor.test/x',
  html: '<p>Sign in</p>',
};

afterEach(() => {
  vi.useRealTimers();
  sendMail.mockReset();
});

describe('sendEmail', () => {
  it('sends the HTML and plain-text versions over SMTP, without attachments', async () => {
    await sendEmail(email);

    expect(sendMail).toHaveBeenCalledWith({
      from: 'Adiutor <no-reply@adiutor.test>',
      to: 'jane@adiutor.test',
      subject: 'Your Adiutor sign-in link',
      text: 'Sign in https://adiutor.test/x',
      html: '<p>Sign in</p>',
    });
  });

  it('fails a send the mail server never finishes, 15 seconds after it started', async () => {
    vi.useFakeTimers();
    // A mail server that accepted the connection and then went silent.
    sendMail.mockReturnValue(new Promise(() => {}));
    let failure: unknown = null;

    const sending = sendEmail(email).catch((error: unknown) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1);
    expect(failure).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await sending;

    expect(SEND_TIMEOUT_MS).toBe(15_000);
    // An ordinary send failure, with nodemailer's code for a timeout and nothing about the email.
    expect(failure).toBeInstanceOf(Error);
    expect(sendFailureOf(failure)).toEqual({ code: 'ETIMEDOUT', responseCode: null });
    expect(String(failure)).not.toContain('jane@adiutor.test');
  });

  it('sends as before when the mail server answers in time, and stops the clock', async () => {
    vi.useFakeTimers();
    sendMail.mockResolvedValue({ accepted: ['jane@adiutor.test'] });

    await expect(sendEmail(email)).resolves.toBeUndefined();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes on the mail server’s refusal, and stops the clock', async () => {
    vi.useFakeTimers();
    const refusal = Object.assign(new Error('Mailbox unavailable'), {
      code: 'EENVELOPE',
      responseCode: 550,
    });
    sendMail.mockRejectedValue(refusal);

    await expect(sendEmail(email)).rejects.toBe(refusal);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the SMTP transport', () => {
  it('closes a connection the mail server leaves hanging, long before nodemailer would', () => {
    expect(transportOptions).toEqual([
      expect.objectContaining({ url: 'smtp://localhost:1025', ...SMTP_TIMEOUTS }),
    ]);
    // Nodemailer's own limits are 2 minutes to connect, 30 seconds for the greeting, 10 minutes of silence.
    expect(Math.max(...Object.values(SMTP_TIMEOUTS))).toBeLessThanOrEqual(20_000);
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
