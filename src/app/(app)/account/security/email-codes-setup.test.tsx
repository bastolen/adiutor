/**
 * @file Tests for turning on email codes: sending the first code is busy, a
 * new one waits half a code's lifetime, checking the code is busy on its own,
 * and a code sent a moment ago counts as sent.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import translator from '@/lib/i18n/translator';
import { EMAIL_CODE_SENT_RECENTLY } from '@/lib/sign-in/sign-in-refusals';

import renderInLocale from '../../../../../tests/i18n/render';
import EmailCodesSetup from './email-codes-setup';

/** What the form says for a code sent a moment ago, from the catalogue. */
const SENT_RECENTLY_TEXT = translator('en-US', 'auth')('codes.errors.EMAIL_CODE_SENT_RECENTLY');

/** The mocked auth client and router. */
const { sendOtp, verifyOtp, push, refresh } = vi.hoisted(() => ({
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/lib/sign-in/auth-client', () => ({ default: { twoFactor: { sendOtp, verifyOtp } } }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose calls are recorded.
   */
  useRouter: () => ({ push, refresh }),
}));

describe('EmailCodesSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is busy while sending the first code, then waits before a new one', async () => {
    const user = userEvent.setup();
    /** Settles the first code's request, which the test holds back while it checks the busy state. */
    let sent: (result: unknown) => void = () => {};
    sendOtp.mockReturnValue(
      new Promise((resolve) => {
        sent = resolve;
      }),
    );
    render(<EmailCodesSetup open onOpenChange={() => {}} email="jane@adiutor.test" />);

    await user.click(screen.getByRole('button', { name: 'Send a code to check it works' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send a code to check it works' })).toHaveAttribute(
        'aria-busy',
        'true',
      ),
    );
    sent({ data: { status: true }, error: null });

    expect(await screen.findByText(/We sent a code to jane@adiutor.test/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new code in 2:30' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Turn on' })).not.toHaveAttribute('aria-busy');
  });

  it('treats a code sent a moment ago as sent, not as an error', async () => {
    const user = userEvent.setup();
    sendOtp.mockResolvedValue({
      data: null,
      error: { status: 429, code: EMAIL_CODE_SENT_RECENTLY.code },
    });
    render(<EmailCodesSetup open onOpenChange={() => {}} email="jane@adiutor.test" />);

    await user.click(screen.getByRole('button', { name: 'Send a code to check it works' }));

    expect(await screen.findByText(SENT_RECENTLY_TEXT)).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    [
      'nl-NL',
      'Stuur een code om te testen of het werkt',
      'We hebben een code naar jane@adiutor.test gestuurd. De code is 5 minuten geldig.',
    ],
    [
      'es-ES',
      'Enviar un código para comprobar que funciona',
      'Hemos enviado un código a jane@adiutor.test. Caduca en 5 minutos.',
    ],
  ] as const)(
    'says in %s where the code went and how long it works',
    async (locale, send, sent) => {
      const user = userEvent.setup();
      sendOtp.mockResolvedValue({ data: { status: true }, error: null });
      renderInLocale(
        locale,
        <EmailCodesSetup open onOpenChange={() => {}} email="jane@adiutor.test" />,
      );

      await user.click(screen.getByRole('button', { name: send }));

      expect(await screen.findByText(sent)).toBeInTheDocument();
    },
  );
});
