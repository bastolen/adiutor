/**
 * @file Tests for the second sign-in step: checking each kind of code, the
 * emailed code sent once each time the page is shown, and starting over when
 * the page is hidden (it stays alive in React's `<Activity>`).
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMAIL_CODE_RESEND_SECONDS } from '@/lib/authz/mfa';
import translator from '@/lib/i18n/translator';
import { EMAIL_CODE_SENT_RECENTLY } from '@/lib/sign-in/sign-in-refusals';

import renderInLocale from '../../../../tests/i18n/render';
import Page from '../../../../tests/ui/page';
import TwoFactorForm from './two-factor-form';

/** What the form says for a code sent a moment ago, from the catalogue. */
const SENT_RECENTLY_TEXT = translator('en-US', 'auth')('codes.errors.EMAIL_CODE_SENT_RECENTLY');

/** Mocked Better Auth client methods and full page load. */
const { verifyTotp, verifyOtp, verifyBackupCode, sendOtp, loadFresh } = vi.hoisted(() => ({
  verifyTotp: vi.fn(),
  verifyOtp: vi.fn(),
  verifyBackupCode: vi.fn(),
  sendOtp: vi.fn(),
  loadFresh: vi.fn(),
}));

/** Query string the mocked `useSearchParams` returns. */
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  /**
   * Mocked query string.
   *
   * @returns The current test's `searchParams`.
   */
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/sign-in/auth-client', () => ({
  default: { twoFactor: { verifyTotp, verifyOtp, verifyBackupCode, sendOtp } },
}));

vi.mock('@/components/ui/load-fresh', () => ({ default: loadFresh }));

/** The label of the checkbox that trusts the browser, which says how long that lasts. */
const TRUST_DEVICE = 'Trust this device (until 30 days after your last password sign-in here)';

describe('TwoFactorForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendOtp.mockResolvedValue({ data: { status: true }, error: null });
    searchParams = new URLSearchParams({ callbackURL: '/companies/x', methods: 'totp,otp' });
  });

  it('checks an authenticator code, trusting the device when asked, then continues', async () => {
    const user = userEvent.setup();
    verifyTotp.mockResolvedValue({ data: {}, error: null });
    render(<TwoFactorForm />);

    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByLabelText(TRUST_DEVICE));
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: true });
    await waitFor(() => expect(loadFresh).toHaveBeenCalledWith('/companies/x', { everyTab: true }));
    expect(sendOtp).not.toHaveBeenCalled();
  });

  it("doesn't offer email codes when an authenticator app is set up", () => {
    render(<TwoFactorForm />);

    expect(screen.queryByRole('button', { name: 'Email code' })).not.toBeInTheDocument();
    expect(sendOtp).not.toHaveBeenCalled();
  });

  it('sends a code straight away when email is the only method, and checks it', async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams({ methods: 'otp' });
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    render(<TwoFactorForm />);

    await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/We sent a code to your email address/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use a backup code' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(verifyOtp).toHaveBeenCalledWith({ code: '654321', trustDevice: false });
  });

  it('waits half a code’s lifetime before another, and says when a new one went out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    searchParams = new URLSearchParams({ methods: 'otp' });
    render(<TwoFactorForm />);

    await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Send a new code in 2:30' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    act(() => {
      vi.advanceTimersByTime(EMAIL_CODE_RESEND_SECONDS * 1000);
    });
    const resend = screen.getByRole('button', { name: 'Send a new code' });
    await user.click(resend);
    expect(sendOtp).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/We sent a new code to your email address/)).toBeInTheDocument();
    // Counting down again, it ignores presses but keeps focus: disabled, it would drop it.
    expect(resend).toHaveAccessibleName('Send a new code in 2:30');
    expect(resend).toHaveAttribute('aria-disabled', 'true');
    expect(resend).toHaveFocus();
    await user.click(resend);
    expect(sendOtp).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it.each([
    [
      'nl-NL',
      'We hebben een code naar je e-mailadres gestuurd. De code is 5 minuten geldig.',
      'Nieuwe code sturen over 2:30',
    ],
    [
      'es-ES',
      'Hemos enviado un código a tu dirección de correo. Caduca en 5 minutos.',
      'Enviar un código nuevo en 2:30',
    ],
  ] as const)(
    'says in %s that a code went out and how long it works',
    async (locale, sent, resend) => {
      searchParams = new URLSearchParams({ methods: 'otp' });
      renderInLocale(locale, <TwoFactorForm />);

      expect(await screen.findByText(sent)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: resend })).toHaveAttribute('aria-disabled', 'true');
    },
  );

  it('shows how long to wait as the server words it', async () => {
    const user = userEvent.setup();
    verifyTotp.mockResolvedValue({
      data: null,
      error: {
        status: 429,
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Te veel pogingen. Probeer het over 12 minuten opnieuw.',
      },
    });
    renderInLocale('nl-NL', <TwoFactorForm />);

    await user.type(screen.getByLabelText('Code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verifiëren en inloggen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Te veel pogingen. Probeer het over 12 minuten opnieuw.',
    );
  });

  it('treats a code sent a moment ago as still usable, not as an error', async () => {
    searchParams = new URLSearchParams({ methods: 'otp' });
    sendOtp.mockResolvedValue({
      data: null,
      error: { status: 429, code: EMAIL_CODE_SENT_RECENTLY.code },
    });
    render(<TwoFactorForm />);

    expect(await screen.findByText(SENT_RECENTLY_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Send a new code in/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('accepts a backup code instead', async () => {
    const user = userEvent.setup();
    verifyBackupCode.mockResolvedValue({ data: {}, error: null });
    render(<TwoFactorForm />);

    await user.click(screen.getByRole('button', { name: 'Use a backup code' }));
    await user.type(screen.getByLabelText('Backup code'), 'ABCDE-12345');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    expect(verifyBackupCode).toHaveBeenCalledWith({ code: 'ABCDE-12345', trustDevice: false });
  });

  it('explains a wrong code', async () => {
    const user = userEvent.setup();
    verifyTotp.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_CODE', status: 401, statusText: 'UNAUTHORIZED' },
    });
    render(<TwoFactorForm />);

    await user.type(screen.getByLabelText('Code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("That code isn't right");
    expect(loadFresh).not.toHaveBeenCalled();
  });

  it('offers to start again when the pending sign-in expired', async () => {
    const user = userEvent.setup();
    verifyTotp.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_TWO_FACTOR_COOKIE', status: 401, statusText: 'UNAUTHORIZED' },
    });
    render(<TwoFactorForm />);

    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your sign-in has expired');
    expect(screen.getByRole('link', { name: 'Start again' })).toHaveAttribute(
      'href',
      '/auth?callbackURL=%2Fcompanies%2Fx',
    );
  });
  it('loads the page asked for afresh once a code is accepted, busy until it goes', async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams({ callbackURL: '/companies/x', methods: 'otp' });
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    render(<TwoFactorForm />);
    await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    // A full load keeps no page alive for the next person to sign in on this browser.
    await waitFor(() => expect(loadFresh).toHaveBeenCalledWith('/companies/x', { everyTab: true }));
    expect(screen.getByRole('button', { name: 'Verify and sign in' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('starts over when the page is hidden before a code is accepted', async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <TwoFactorForm />
      </Page>,
    );

    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByLabelText(TRUST_DEVICE));
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(screen.getByLabelText(TRUST_DEVICE)).not.toBeChecked();
  });

  it('emails a new code when the page is shown again, as after going back and signing in again', async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams({ methods: 'otp' });
    render(
      <Page>
        <TwoFactorForm />
      </Page>,
    );
    await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/We sent a code to your email address/)).toBeInTheDocument();

    // Back to the sign-in page, and a new sign-in shows this same page again.
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(sendOtp).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Return' }));

    // The first email's code belongs to the sign-in it replaced: before, nothing was sent and
    // nothing said.
    await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/We sent a code to your email address/)).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveValue('');
  });

  it('says to use the last code when the page is shown again and the server says it still works', async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams({ methods: 'otp' });
    render(
      <Page>
        <TwoFactorForm />
      </Page>,
    );
    await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(1));
    // The same sign-in, e.g. back and forward in the browser's history.
    sendOtp.mockResolvedValueOnce({
      data: null,
      error: { status: 429, code: EMAIL_CODE_SENT_RECENTLY.code },
    });

    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(await screen.findByText(SENT_RECENTLY_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(sendOtp).toHaveBeenCalledTimes(2);
  });

  it('emails one code on mount in Strict Mode, which runs effects twice', async () => {
    searchParams = new URLSearchParams({ methods: 'otp' });
    render(
      <StrictMode>
        <TwoFactorForm />
      </StrictMode>,
    );

    expect(await screen.findByText(/We sent a code to your email address/)).toBeInTheDocument();
    expect(sendOtp).toHaveBeenCalledTimes(1);
  });

  it('emails no code when the page is shown again for an authenticator app', async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <TwoFactorForm />
      </Page>,
    );

    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(sendOtp).not.toHaveBeenCalled();
  });

  it('is usable again when the browser shows the page from its back/forward cache', async () => {
    const user = userEvent.setup();
    verifyTotp.mockReturnValue(new Promise(() => {}));
    render(<TwoFactorForm />);
    const verify = screen.getByRole('button', { name: 'Verify and sign in' });

    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(verify);
    expect(verify).toHaveAttribute('aria-busy', 'true');
    expect(verify).toHaveAttribute('aria-disabled', 'true');
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });

    expect(verify).not.toHaveAttribute('aria-busy');
    expect(verify).not.toHaveAttribute('aria-disabled');
  });
});
