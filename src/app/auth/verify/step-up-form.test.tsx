/**
 * @file Tests for the step-up form: which ways to confirm it offers, which
 * Better Auth calls each one makes, how it explains why the session needs
 * confirming, that it starts over after a confirmation (the page stays alive
 * in React's `<Activity>`) and emails its code once each time it's shown,
 * that it says why "Confirm with GitHub" didn't
 * count until the session is confirmed, and that a failed sign-out says so
 * instead of loading the sign-in page.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Activity, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMAIL_CODE_RESEND_SECONDS, type StepUpMethods } from '@/lib/authz/mfa';
import {
  type MfaProvider,
  PROVIDER_STEP_UP_COOKIE,
  REVERIFY_HINT,
} from '@/lib/sign-in/oauth-providers';
import { EMAIL_CODE_SENT_RECENTLY } from '@/lib/sign-in/sign-in-refusals';

import renderInLocale from '../../../../tests/i18n/render';
import StepUpForm, { type StepUpFormProps } from './step-up-form';

/** Mocked Better Auth client methods, router and full page load. */
const {
  verifyTotp,
  verifyOtp,
  verifyBackupCode,
  sendOtp,
  passkey,
  social,
  signOut,
  replace,
  loadFresh,
} = vi.hoisted(() => ({
  signOut: vi.fn(async () => ({})),
  loadFresh: vi.fn(),
  verifyTotp: vi.fn(),
  verifyOtp: vi.fn(),
  verifyBackupCode: vi.fn(),
  sendOtp: vi.fn(),
  passkey: vi.fn(),
  social: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router; `replace` is recorded.
   *
   * @returns The router.
   */
  useRouter: () => ({ replace, refresh: vi.fn() }),
}));

vi.mock('@/lib/sign-in/auth-client', () => ({
  default: {
    twoFactor: { verifyTotp, verifyOtp, verifyBackupCode, sendOtp },
    signIn: { passkey, social },
    signOut,
  },
}));

vi.mock('@/components/ui/load-fresh', () => ({ default: loadFresh }));

// A second provider that can prove MFA, for tests only (GitHub is the only real one so far).
vi.mock('@/lib/sign-in/oauth-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sign-in/oauth-providers')>();
  return { ...actual, PROVIDER_LABELS: { ...actual.PROVIDER_LABELS, gitlab: 'GitLab' } };
});
vi.mock('@/components/brand/provider-icons', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand/provider-icons')>();
  /**
   * The test-only provider's icon.
   *
   * @returns Nothing to show.
   */
  function GitLabIcon() {
    return null;
  }
  return { ...actual, default: { ...actual.default, gitlab: GitLabIcon } };
});

/** The test-only second provider. */
const GITLAB = 'gitlab' as MfaProvider;

/** No way to confirm; tests switch on what they need. */
const none: StepUpMethods = { authenticator: false, email: false, passkey: false, providers: [] };

/**
 * Renders the form inside React's `<Activity>`, the way Next.js keeps a page
 * alive between visits.
 *
 * @param props - The form's props.
 * @returns `leaveAndReturn`, which hides the page and shows it again a moment
 *   later, like navigating away and coming back.
 */
function renderOnPage(props: StepUpFormProps) {
  /**
   * The page with the form.
   *
   * @param mode - Whether the page is shown.
   * @returns The page.
   */
  const page = (mode: 'visible' | 'hidden') => (
    <Activity mode={mode}>
      <StepUpForm {...props} />
    </Activity>
  );
  const view = render(page('visible'));
  return {
    /** Hides the page, then shows it again once what it does on leaving has run. */
    leaveAndReturn: async () => {
      view.rerender(page('hidden'));
      await act(async () => {});
      view.rerender(page('visible'));
    },
  };
}

/**
 * A promise the test settles itself, to look at the form while a request runs.
 *
 * @returns The promise and the function that fulfils it.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('StepUpForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendOtp.mockResolvedValue({ data: { status: true }, error: null });
    [verifyTotp, verifyOtp, verifyBackupCode].forEach((verify) =>
      verify.mockResolvedValue({ data: {}, error: null }),
    );
  });

  it('signs out and loads the sign-in page afresh, leaving no page alive for the next person', async () => {
    const user = userEvent.setup();
    render(<StepUpForm methods={{ ...none, authenticator: true }} callbackURL="/account" />);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalled();
    await waitFor(() => expect(loadFresh).toHaveBeenCalledWith('/auth', { everyTab: true }));
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the server refuses it',
      () => signOut.mockResolvedValueOnce({ data: null, error: { status: 500 } }),
    ],
    [
      'the request never gets there',
      () => signOut.mockRejectedValueOnce(new TypeError('Failed to fetch')),
    ],
  ])('says that signing out failed when %s, and stays on the page', async (_, fail) => {
    const user = userEvent.setup();
    fail();
    render(<StepUpForm methods={{ ...none, authenticator: true }} callbackURL="/account" />);
    const button = screen.getByRole('button', { name: 'Sign out' });

    await user.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Signing out failed. Please try again.',
    );
    // Still signed in: the sign-in page would only send them back here, in every tab.
    expect(loadFresh).not.toHaveBeenCalled();

    // The button still works: a second try that succeeds signs out.
    await user.click(button);
    await waitFor(() => expect(loadFresh).toHaveBeenCalledWith('/auth', { everyTab: true }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('checks an authenticator code, then continues', async () => {
    const user = userEvent.setup();
    render(<StepUpForm methods={{ ...none, authenticator: true }} callbackURL="/account" />);

    expect(screen.queryByRole('button', { name: /email/i })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/account'));
    expect(sendOtp).not.toHaveBeenCalled();
  });

  it('comes back to the card the user was on, with its tables', async () => {
    const user = userEvent.setup();
    render(
      <StepUpForm
        methods={{ ...none, authenticator: true }}
        callbackURL="/admin/settings/staff?inv-page=2#invitations"
      />,
    );

    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/admin/settings/staff?inv-page=2#invitations'),
    );
  });

  it('takes a backup code instead of an authenticator code, and can switch back', async () => {
    const user = userEvent.setup();
    render(<StepUpForm methods={{ ...none, authenticator: true }} callbackURL="/account" />);

    await user.click(screen.getByRole('button', { name: 'Use a backup code' }));
    await user.click(screen.getByRole('button', { name: 'Use a code instead' }));
    expect(screen.getByLabelText('Code')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use a backup code' }));
    await user.type(screen.getByLabelText('Backup code'), ' abcd-efgh ');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(verifyBackupCode).toHaveBeenCalledWith({ code: 'abcd-efgh' });
    expect(verifyTotp).not.toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/account'));
  });

  it('emails a code straight away when that is the only way, and can send another after the wait', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<StepUpForm methods={{ ...none, email: true }} callbackURL="/account" />);

    await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/We sent a code to your email address/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use a backup code' })).not.toBeInTheDocument();
    // No new code until half the first one's lifetime has passed.
    expect(screen.getByRole('button', { name: 'Send a new code in 2:30' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    act(() => {
      vi.advanceTimersByTime(EMAIL_CODE_RESEND_SECONDS * 1000);
    });
    await user.click(screen.getByRole('button', { name: 'Send a new code' }));
    expect(sendOtp).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/We sent a new code to your email address/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(verifyOtp).toHaveBeenCalledWith({ code: '654321' });
    expect(verifyTotp).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('offers a passkey first, and only emails a code on request', async () => {
    const user = userEvent.setup();
    passkey.mockResolvedValue({ data: {}, error: null });
    render(<StepUpForm methods={{ ...none, email: true, passkey: true }} callbackURL="/account" />);

    expect(screen.getByText('or enter a code')).toBeInTheDocument();
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument();
    expect(sendOtp).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(sendOtp).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText('Code')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm with a passkey' }));
    expect(passkey).toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/account'));
  });

  it('keeps focus on the passkey button while its prompt is open, and the others wait', async () => {
    const user = userEvent.setup();
    const prompt = deferred<object>();
    passkey.mockReturnValue(prompt.promise);
    render(
      <StepUpForm
        methods={{ ...none, authenticator: true, passkey: true, providers: ['github'] }}
        callbackURL="/account"
      />,
    );
    const button = screen.getByRole('button', { name: 'Confirm with a passkey' });
    const others = [
      screen.getByRole('button', { name: 'Confirm with GitHub' }),
      screen.getByRole('button', { name: 'Confirm' }),
    ];

    button.focus();
    await user.keyboard('{Enter}');

    // Busy, not disabled: a disabled button would drop focus to the top of the page.
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeEnabled();
    // The others can't start a second confirmation, and show no spinner of their own.
    others.forEach((other) => {
      expect(other).toBeDisabled();
      expect(other).not.toHaveAttribute('aria-busy');
    });

    await act(async () => {
      prompt.resolve({ data: null, error: { code: 'AUTH_CANCELLED', status: 400 } });
    });

    [button, ...others].forEach((other) => {
      expect(other).toBeEnabled();
      expect(other).not.toHaveAttribute('aria-busy');
    });
  });

  describe('starts over after a confirmation', () => {
    it('is ready again once an authenticator code was accepted', async () => {
      const user = userEvent.setup();
      const request = deferred<{ data: object; error: null }>();
      verifyTotp.mockReturnValue(request.promise);
      render(<StepUpForm methods={{ ...none, authenticator: true }} callbackURL="/account" />);

      await user.type(screen.getByLabelText('Code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(screen.getByRole('button', { name: 'Confirm' })).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('button', { name: 'Confirm' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );

      await act(async () => request.resolve({ data: {}, error: null }));

      expect(replace).toHaveBeenCalledWith('/account');
      expect(screen.getByRole('button', { name: 'Confirm' })).not.toHaveAttribute('aria-busy');
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
      expect(screen.getByLabelText('Code')).toHaveValue('');
    });

    it('asks for an authenticator code again after a backup code, when the user comes back', async () => {
      const user = userEvent.setup();
      const { leaveAndReturn } = renderOnPage({
        methods: { ...none, authenticator: true },
        callbackURL: '/account/security',
      });

      await user.click(screen.getByRole('button', { name: 'Use a backup code' }));
      await user.type(screen.getByLabelText('Backup code'), 'abcd-efgh');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/account/security'));

      await leaveAndReturn();

      expect(screen.queryByLabelText('Backup code')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Code')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Use a backup code' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Confirm' })).not.toHaveAttribute('aria-busy');
    });

    it('emails a new code when the user comes back, with email codes as the only way', async () => {
      const user = userEvent.setup();
      const { leaveAndReturn } = renderOnPage({
        methods: { ...none, email: true },
        callbackURL: '/account/security',
      });
      await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(1));

      await user.type(await screen.findByLabelText('Code'), '654321');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(verifyOtp).toHaveBeenCalledWith({ code: '654321' });
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/account/security'));

      await leaveAndReturn();

      await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(2));
      expect(await screen.findByText(/We sent a code to your email address/)).toBeInTheDocument();
      expect(screen.getByLabelText('Code')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Confirm' })).not.toHaveAttribute('aria-busy');
    });

    it('emails a code again when the user comes back without confirming, and says so', async () => {
      const { leaveAndReturn } = renderOnPage({
        methods: { ...none, email: true },
        callbackURL: '/account/security',
      });
      await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(1));
      expect(await screen.findByLabelText('Code')).toBeInTheDocument();

      await leaveAndReturn();

      // The first code may have run out by now; before, nothing was sent and nothing said.
      await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(2));
      expect(await screen.findByText(/We sent a code to your email address/)).toBeInTheDocument();
      expect(screen.getByLabelText('Code')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Send a new code/ })).toBeInTheDocument();
    });

    it('says to use the last code when the server says it still works', async () => {
      const { leaveAndReturn } = renderOnPage({
        methods: { ...none, email: true },
        callbackURL: '/account/security',
      });
      await waitFor(() => expect(sendOtp).toHaveBeenCalledTimes(1));
      expect(await screen.findByLabelText('Code')).toBeInTheDocument();
      sendOtp.mockResolvedValueOnce({
        data: null,
        error: { status: 429, code: EMAIL_CODE_SENT_RECENTLY.code },
      });

      await leaveAndReturn();

      expect(await screen.findByText(EMAIL_CODE_SENT_RECENTLY.message)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Code')).toBeInTheDocument();
      expect(sendOtp).toHaveBeenCalledTimes(2);
    });

    it('emails one code on mount in Strict Mode, which runs effects twice', async () => {
      render(
        <StrictMode>
          <StepUpForm methods={{ ...none, email: true }} callbackURL="/account" />
        </StrictMode>,
      );

      expect(await screen.findByText(/We sent a code to your email address/)).toBeInTheDocument();
      expect(sendOtp).toHaveBeenCalledTimes(1);
    });

    it('offers to email a code again, rather than the old one, after a passkey', async () => {
      const user = userEvent.setup();
      passkey.mockResolvedValue({ data: {}, error: null });
      const { leaveAndReturn } = renderOnPage({
        methods: { ...none, email: true, passkey: true },
        callbackURL: '/account/security',
      });

      await user.click(screen.getByRole('button', { name: 'Email me a code' }));
      expect(await screen.findByLabelText('Code')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Confirm with a passkey' }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/account/security'));

      await leaveAndReturn();

      expect(screen.queryByLabelText('Code')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Send a new code' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Email me a code' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Confirm with a passkey' })).toBeEnabled();
      expect(sendOtp).toHaveBeenCalledTimes(1);
    });
  });

  describe('confirming with a provider that can prove MFA', () => {
    it('signs in again with that provider as a re-verify, and comes back here naming it on failure', async () => {
      social.mockResolvedValue({ data: null, error: null });
      render(<StepUpForm methods={{ ...none, providers: ['github'] }} callbackURL="/account" />);

      await userEvent.click(screen.getByRole('button', { name: 'Confirm with GitHub' }));

      expect(social).toHaveBeenCalledWith({
        provider: 'github',
        callbackURL: '/account',
        errorCallbackURL: '/auth/verify?callbackURL=%2Faccount&provider=github',
        // The server marks it as confirming this session only with this hint (`markReverify`).
        additionalData: { [REVERIFY_HINT]: true },
      });
    });

    it('keeps the anchor through the provider, and in the page it comes back to on failure', async () => {
      social.mockResolvedValue({ data: null, error: null });
      render(
        <StepUpForm
          methods={{ ...none, providers: ['github'] }}
          callbackURL="/admin/settings/staff#invitations"
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: 'Confirm with GitHub' }));

      expect(social).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackURL: '/admin/settings/staff#invitations',
          errorCallbackURL:
            '/auth/verify?callbackURL=%2Fadmin%2Fsettings%2Fstaff%23invitations&provider=github',
        }),
      );
    });

    it('offers one button per provider, each signing in with its own', async () => {
      social.mockResolvedValue({ data: null, error: null });
      render(
        <StepUpForm methods={{ ...none, providers: ['github', GITLAB] }} callbackURL="/account" />,
      );

      expect(screen.getByRole('button', { name: 'Confirm with GitHub' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Confirm with GitLab' }));

      expect(social).toHaveBeenCalledTimes(1);
      expect(social).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gitlab' }));
    });

    it('names the provider when signing in with it fails', async () => {
      social.mockResolvedValue({ data: null, error: { status: 500 } });
      render(<StepUpForm methods={{ ...none, providers: ['github'] }} callbackURL="/account" />);

      await userEvent.click(screen.getByRole('button', { name: 'Confirm with GitHub' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Signing in with GitHub failed. Please try again.',
      );
    });

    it("doesn't email a code by itself while a provider is offered too", () => {
      render(
        <StepUpForm
          methods={{ ...none, email: true, providers: ['github'] }}
          callbackURL="/account"
        />,
      );

      expect(screen.getByRole('button', { name: 'Confirm with GitHub' })).toBeInTheDocument();
      expect(sendOtp).not.toHaveBeenCalled();
    });
  });

  describe('says why the session needs confirming', () => {
    /** Confirming with GitHub only, so no code is emailed on mount. */
    const githubOnly: StepUpMethods = { ...none, providers: ['github'] };

    it('for a role that requires MFA', () => {
      render(<StepUpForm methods={githubOnly} callbackURL="/account" roleRequiresMfa />);

      expect(
        screen.getByText(/Your role requires MFA, and this sign-in isn’t MFA verified yet\./),
      ).toBeInTheDocument();
      expect(screen.queryByText(/You turned on MFA/)).not.toBeInTheDocument();
    });

    it('for an account that has MFA whose role doesn’t require it', () => {
      render(
        <StepUpForm
          methods={githubOnly}
          callbackURL="/account"
          roleRequiresMfa={false}
          accountHasMfa
        />,
      );

      expect(
        screen.getByText(/You turned on MFA, and this sign-in didn’t use it yet\./),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Your role requires MFA/)).not.toBeInTheDocument();
    });

    it('assumes the account has MFA unless told otherwise', () => {
      render(<StepUpForm methods={githubOnly} callbackURL="/account" />);

      expect(screen.getByText(/You turned on MFA/)).toBeInTheDocument();
    });

    it('for a role that requires MFA, confirming with GitHub before setting MFA up', () => {
      render(
        <StepUpForm
          methods={githubOnly}
          callbackURL="/account"
          roleRequiresMfa
          accountHasMfa={false}
        />,
      );

      expect(screen.getByText(/Your role requires MFA/)).toBeInTheDocument();
      expect(screen.queryByText(/You turned on MFA/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirm with GitHub' })).toBeInTheDocument();
    });

    it('for an account without MFA whose second step is GitHub', () => {
      render(
        <StepUpForm
          methods={githubOnly}
          callbackURL="/account"
          roleRequiresMfa={false}
          accountHasMfa={false}
        />,
      );

      expect(screen.getByText(/This needs your second step\./)).toBeInTheDocument();
      expect(screen.queryByText(/You turned on MFA/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Your role requires MFA/)).not.toBeInTheDocument();
    });

    it('for a session confirmed too long ago, without naming what the user came to do', () => {
      render(
        <StepUpForm
          methods={githubOnly}
          callbackURL="/account/security"
          roleRequiresMfa
          accountHasMfa
          confirmedBefore
        />,
      );

      expect(
        screen.getByText(/This needs a confirmation from the last 15 minutes\./),
      ).toBeInTheDocument();
      // The same page confirms before giving someone a role, resetting someone's two-step
      // verification and signing in as a user, so it doesn't say it's about how they sign in.
      expect(screen.queryByText(/how you sign in/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Your role requires MFA/)).not.toBeInTheDocument();
      expect(screen.queryByText(/You turned on MFA/)).not.toBeInTheDocument();
      // GitHub is offered, so nothing says it can't confirm the change.
      expect(screen.queryByText(/can’t confirm this/)).not.toBeInTheDocument();
    });

    it('for a change, why GitHub isn’t offered next to a passkey or an authenticator app', () => {
      render(
        <StepUpForm
          methods={{ ...none, passkey: true, providersHeldBack: ['github'] }}
          callbackURL="/account/security"
          roleRequiresMfa
          accountHasMfa
          confirmedBefore
        />,
      );

      expect(
        screen.getByText(
          "This needs a confirmation from the last 15 minutes. GitHub can’t confirm this while you have a passkey or an authenticator app. Confirm it's you to continue.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirm with a passkey' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Confirm with GitHub' })).not.toBeInTheDocument();
    });

    it.each([
      [
        'nl-NL',
        'Hiervoor is een bevestiging van de afgelopen 15 minuten nodig. GitHub of Google kan dit niet bevestigen zolang je een passkey of authenticator-app hebt. Bevestig dat jij het bent om verder te gaan.',
      ],
      [
        'es-ES',
        'Para esto hace falta una confirmación de los últimos 15 minutos. GitHub o Google no puede confirmar esto mientras tengas una llave de acceso o una app de autenticación. Confirma que eres tú para continuar.',
      ],
    ] as const)('says the same in %s, naming the providers in its own words', (locale, text) => {
      renderInLocale(
        locale,
        <StepUpForm
          // Named by the real provider list, which only knows the configured providers' names.
          methods={{
            ...none,
            passkey: true,
            providersHeldBack: ['github', 'google' as MfaProvider],
          }}
          callbackURL="/account/security"
          roleRequiresMfa
          accountHasMfa
          confirmedBefore
        />,
      );

      expect(screen.getByText(text)).toBeInTheDocument();
    });
  });

  describe('after "Confirm with GitHub" didn’t confirm the session', () => {
    afterEach(() => {
      document.cookie = `${PROVIDER_STEP_UP_COOKIE}=; Max-Age=0; path=/`;
    });

    it('says why below the heading, and removes it once another way confirms the session', async () => {
      const user = userEvent.setup();
      // Left by the GitHub callback that brought the user back here.
      document.cookie = `${PROVIDER_STEP_UP_COOKIE}=github%3Amfa-off; path=/`;
      verifyTotp.mockResolvedValueOnce({
        data: null,
        error: { status: 401, code: 'INVALID_CODE' },
      });
      render(<StepUpForm methods={{ ...none, authenticator: true }} callbackURL="/account" />);

      const notice = screen.getByRole('region', { name: 'GitHub confirmation' });
      expect(notice).toHaveTextContent(
        "GitHub couldn't confirm it's you: two-factor authentication is off for your GitHub account.",
      );
      expect(
        screen.getByRole('heading', { name: /^Confirm it.s you$/ }).compareDocumentPosition(notice),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      // The code field keeps its focus: the notice is announced, not focused.
      expect(screen.getByLabelText('Code')).toHaveFocus();

      // A refused code doesn't answer it.
      await user.type(screen.getByLabelText('Code'), '000000');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(
        await screen.findByText("That code isn't right. Check it and try again."),
      ).toBeVisible();
      expect(notice).toBeInTheDocument();
      expect(document.cookie).toContain(PROVIDER_STEP_UP_COOKIE);

      await user.clear(screen.getByLabelText('Code'));
      await user.type(screen.getByLabelText('Code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      await waitFor(() => expect(replace).toHaveBeenCalledWith('/account'));
      expect(document.cookie).not.toContain(PROVIDER_STEP_UP_COOKIE);
      expect(screen.queryByRole('region', { name: 'GitHub confirmation' })).not.toBeInTheDocument();
    });
  });

  it('shows why a code was refused', async () => {
    const user = userEvent.setup();
    verifyTotp.mockResolvedValue({ data: null, error: { status: 429, code: 'TOO_MANY_ATTEMPTS' } });
    render(<StepUpForm methods={{ ...none, authenticator: true }} callbackURL="/account" />);

    await user.type(screen.getByLabelText('Code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many/i);
    expect(replace).not.toHaveBeenCalled();
  });
});
