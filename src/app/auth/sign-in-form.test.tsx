/**
 * @file Tests for the sign-in form.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StaffNameProvider } from '@/components/brand/staff-name';

import renderInLocale from '../../../tests/i18n/render';
import Page from '../../../tests/ui/page';
import SignInForm from './sign-in-form';

/** Mocked Better Auth client methods, router and full page load. */
const {
  signInEmail,
  signInMagicLink,
  signInSocial,
  signInPasskey,
  getLastUsedLoginMethod,
  push,
  loadFresh,
} = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signInMagicLink: vi.fn(),
  signInSocial: vi.fn(),
  signInPasskey: vi.fn(),
  getLastUsedLoginMethod: vi.fn(),
  push: vi.fn(),
  loadFresh: vi.fn(),
}));

/** Query string the mocked `useSearchParams` returns. */
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  /**
   * Mocked router; `push` is recorded (the code step comes before the session).
   *
   * @returns The router.
   */
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  /**
   * Mocked query string.
   *
   * @returns The current test's `searchParams`.
   */
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/sign-in/auth-client', () => ({
  default: {
    signIn: {
      email: signInEmail,
      magicLink: signInMagicLink,
      social: signInSocial,
      passkey: signInPasskey,
    },
    getLastUsedLoginMethod,
  },
}));

vi.mock('@/components/ui/load-fresh', () => ({ default: loadFresh }));

describe('SignInForm', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    vi.clearAllMocks();
    getLastUsedLoginMethod.mockReturnValue(null);
  });

  it('asks to sign in to the staff, by their name', () => {
    const { unmount } = render(<SignInForm providers={[]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to Adiutor' })).toBeVisible();
    unmount();

    renderInLocale(
      'nl-NL',
      <StaffNameProvider name="Adiutor Tests Support">
        <SignInForm providers={[]} />
      </StaffNameProvider>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Inloggen bij Adiutor Tests Support' }),
    ).toBeVisible();
  });

  it('marks the method used last time without changing button names', () => {
    getLastUsedLoginMethod.mockReturnValue('github');
    render(<SignInForm providers={['github', 'google']} />);

    const github = screen.getByRole('button', { name: 'Continue with GitHub' });
    expect(github).toHaveAccessibleDescription('Last used');
    expect(
      screen.getByRole('button', { name: 'Continue with Google' }),
    ).not.toHaveAccessibleDescription();
    expect(github).toHaveTextContent('Last used');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).not.toHaveTextContent(
      'Last used',
    );
  });

  it('marks the password option for a password sign-in', () => {
    getLastUsedLoginMethod.mockReturnValue('email');
    render(<SignInForm providers={[]} />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAccessibleDescription(
      'Last used',
    );
  });

  it('only offers the OAuth providers that are configured', () => {
    render(<SignInForm providers={['github']} />);
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
  });

  it('shows the message for an error code in the URL', () => {
    searchParams = new URLSearchParams({ error: 'signup_disabled' });
    render(<SignInForm providers={[]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('no account for that email address');
  });

  it('shows the note another page sent the user here with, and nothing for an unknown one', () => {
    searchParams = new URLSearchParams({ notice: 'joined-mfa-required' });
    const { unmount } = render(<SignInForm providers={[]} />);
    expect(screen.getByText(/You’ve joined\. Your new role requires MFA/)).toBeInTheDocument();
    unmount();

    searchParams = new URLSearchParams({ notice: 'something-else' });
    render(<SignInForm providers={[]} />);
    expect(screen.queryByText(/You’ve joined/)).not.toBeInTheDocument();
  });

  it('shows a clear message for a wrong password', async () => {
    signInEmail.mockResolvedValue({ error: { status: 401, message: 'Invalid email or password' } });
    render(<SignInForm providers={[]} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@adiutor.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email and password combination is incorrect.',
    );
  });

  it('shows the refusals the server words itself as they come', async () => {
    const paused =
      'Password sign-in for this address is paused for 15 minutes after too many wrong passwords. Sign in with an email link or a passkey, or reset your password to lift the pause.';
    signInEmail.mockResolvedValue({
      error: { status: 429, code: 'PASSWORD_SIGN_IN_PAUSED', message: paused },
    });
    render(<SignInForm providers={[]} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@adiutor.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(paused);
  });

  it("never shows Better Auth's own English message", async () => {
    signInMagicLink.mockResolvedValue({
      error: { status: 400, code: 'SOMETHING_NEW', message: 'Something new went wrong' },
    });
    render(<SignInForm providers={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with an email link instead' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@adiutor.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sending the link failed. Please try again.',
    );
  });

  it.each([
    [
      'nl-NL',
      'Liever inloggen met een e-maillink',
      'E-mailadres',
      'Stuur me een inloglink',
      'Als jan@adiutor.test een account heeft, is er een inloglink onderweg. Kijk in je inbox.',
    ],
    [
      'es-ES',
      'Usar un enlace por correo',
      'Correo electrónico',
      'Enviarme un enlace de acceso',
      'Si jan@adiutor.test tiene una cuenta, le llegará un enlace para iniciar sesión. Revisa tu bandeja de entrada.',
    ],
  ] as const)(
    'says in %s that a link is on its way, with the address where the language puts it',
    async (locale, useLink, emailLabel, submit, sent) => {
      signInMagicLink.mockResolvedValue({ error: null });
      renderInLocale(locale, <SignInForm providers={['github']} />);

      fireEvent.click(screen.getByRole('button', { name: useLink }));
      fireEvent.change(screen.getByLabelText(emailLabel), {
        target: { value: 'jan@adiutor.test' },
      });
      fireEvent.click(screen.getByRole('button', { name: submit }));

      expect(await screen.findByRole('status')).toHaveTextContent(sent);
    },
  );

  it('sends a magic link back to the requested page', async () => {
    searchParams = new URLSearchParams({ callbackURL: '/dashboard/settings' });
    signInMagicLink.mockResolvedValue({ error: null });
    render(<SignInForm providers={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with an email link instead' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@adiutor.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));

    expect(await screen.findByRole('status')).toHaveTextContent('a sign-in link is on its way');
    expect(signInMagicLink).toHaveBeenCalledWith({
      email: 'jane@adiutor.test',
      callbackURL: '/dashboard/settings',
      errorCallbackURL: '/auth?callbackURL=%2Fdashboard%2Fsettings',
    });
  });

  describe('the anchor the browser kept from the page first asked for', () => {
    afterEach(() => {
      window.history.replaceState(null, '', '/');
    });

    it('goes on to that card after signing in', async () => {
      // The proxy sent `/admin/settings/staff#invitations` here; the browser kept the anchor.
      searchParams = new URLSearchParams({ callbackURL: '/admin/settings/staff' });
      window.history.replaceState(
        null,
        '',
        '/auth?callbackURL=%2Fadmin%2Fsettings%2Fstaff#invitations',
      );
      signInPasskey.mockResolvedValue({ data: {}, error: null });
      render(<SignInForm providers={[]} />);

      fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

      await vi.waitFor(() =>
        expect(loadFresh).toHaveBeenCalledWith('/admin/settings/staff#invitations', {
          everyTab: true,
        }),
      );
    });

    it('keeps it through the code step, an email link and a provider', async () => {
      searchParams = new URLSearchParams({ callbackURL: '/admin/settings/staff' });
      window.history.replaceState(
        null,
        '',
        '/auth?callbackURL=%2Fadmin%2Fsettings%2Fstaff#invitations',
      );
      signInEmail.mockResolvedValue({
        data: { twoFactorRedirect: true, twoFactorMethods: ['totp'] },
        error: null,
      });
      signInSocial.mockResolvedValue({ error: null });
      signInMagicLink.mockResolvedValue({ error: null });
      // Each sign-in leaves the page busy, so each gets a page of its own.
      const first = render(<SignInForm providers={[]} />);
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@adiutor.test' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      await vi.waitFor(() =>
        expect(push).toHaveBeenCalledWith(
          '/auth/two-factor?callbackURL=%2Fadmin%2Fsettings%2Fstaff%23invitations&methods=totp',
        ),
      );
      first.unmount();

      const second = render(<SignInForm providers={[]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with an email link instead' }));
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@adiutor.test' } });
      fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
      await vi.waitFor(() =>
        expect(signInMagicLink).toHaveBeenCalledWith({
          email: 'jane@adiutor.test',
          callbackURL: '/admin/settings/staff#invitations',
          errorCallbackURL: '/auth?callbackURL=%2Fadmin%2Fsettings%2Fstaff%23invitations',
        }),
      );
      second.unmount();

      render(<SignInForm providers={['github']} />);
      fireEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
      await vi.waitFor(() =>
        expect(signInSocial).toHaveBeenCalledWith({
          provider: 'github',
          callbackURL: '/admin/settings/staff#invitations',
          errorCallbackURL: '/auth?callbackURL=%2Fadmin%2Fsettings%2Fstaff%23invitations',
        }),
      );
    });

    it("leaves a callbackURL's own anchor alone", async () => {
      searchParams = new URLSearchParams({ callbackURL: '/admin/settings/staff#invite' });
      window.history.replaceState(null, '', '/auth#invitations');
      signInPasskey.mockResolvedValue({ data: {}, error: null });
      render(<SignInForm providers={[]} />);

      fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

      await vi.waitFor(() =>
        expect(loadFresh).toHaveBeenCalledWith('/admin/settings/staff#invite', { everyTab: true }),
      );
    });

    it.each(['#:~:text=secret', '#100%', '#top'])(
      'ignores %j, which names no section',
      async (hash) => {
        searchParams = new URLSearchParams({ callbackURL: '/admin/settings/staff' });
        window.history.replaceState(null, '', `/auth${hash}`);
        signInPasskey.mockResolvedValue({ data: {}, error: null });
        render(<SignInForm providers={[]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

        await vi.waitFor(() =>
          expect(loadFresh).toHaveBeenCalledWith('/admin/settings/staff', { everyTab: true }),
        );
      },
    );
  });

  it('continues on the code step when two-step verification is on', async () => {
    signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true, twoFactorMethods: ['totp', 'otp'] },
      error: null,
    });
    render(<SignInForm providers={[]} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@adiutor.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await vi.waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        '/auth/two-factor?callbackURL=%2Fdashboard&methods=totp%2Cotp',
      ),
    );
    expect(loadFresh).not.toHaveBeenCalled();
  });

  it('signs in with a passkey', async () => {
    signInPasskey.mockResolvedValue({ data: {}, error: null });
    render(<SignInForm providers={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    // The browser's other tabs load their page afresh too, signed in.
    await vi.waitFor(() =>
      expect(loadFresh).toHaveBeenCalledWith('/dashboard', { everyTab: true }),
    );
  });

  it('explains a cancelled passkey prompt', async () => {
    signInPasskey.mockResolvedValue({
      data: null,
      error: { code: 'AUTH_CANCELLED', status: 400, statusText: 'BAD_REQUEST' },
    });
    render(<SignInForm providers={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('passkey was cancelled');
  });

  it('keeps focus on the passkey button while its prompt is open, and the others wait', async () => {
    /**
     * Answers the passkey prompt; replaced by the promise's own resolver below.
     *
     * @returns Nothing.
     */
    let answer: (result: object) => void = () => undefined;
    signInPasskey.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    render(<SignInForm providers={['github']} />);
    const passkey = screen.getByRole('button', { name: 'Sign in with a passkey' });
    const others = [
      screen.getByRole('button', { name: 'Continue with GitHub' }),
      screen.getByRole('button', { name: 'Sign in' }),
    ];

    passkey.focus();
    fireEvent.click(passkey);

    // Busy, not disabled: a disabled button would drop focus to the top of the page.
    expect(passkey).toHaveFocus();
    expect(passkey).toHaveAttribute('aria-busy', 'true');
    expect(passkey).toBeEnabled();
    // The others can't start a second sign-in, and show no spinner of their own.
    others.forEach((other) => {
      expect(other).toBeDisabled();
      expect(other).not.toHaveAttribute('aria-busy');
    });

    await act(async () => {
      answer({ data: null, error: { code: 'AUTH_CANCELLED', status: 400 } });
    });

    [passkey, ...others].forEach((button) => {
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-busy');
    });
  });
  it('starts over when the page is hidden, so the next person finds an empty form', async () => {
    signInEmail.mockResolvedValue({ data: {}, error: null });
    render(
      <Page>
        <SignInForm providers={[]} />
      </Page>,
    );

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@adiutor.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() =>
      expect(loadFresh).toHaveBeenCalledWith('/dashboard', { everyTab: true }),
    );

    // Signed in, the page is left; signing out shows it again.
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));

    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeEnabled();
  });

  it('is usable again when the browser shows the page from its back/forward cache', async () => {
    signInSocial.mockResolvedValue({ data: { url: 'https://github.com/login' }, error: null });
    render(<SignInForm providers={['github']} />);
    const github = screen.getByRole('button', { name: 'Continue with GitHub' });

    fireEvent.click(github);
    await vi.waitFor(() => expect(github).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeDisabled();
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });

    expect(github).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeEnabled();
  });
});
