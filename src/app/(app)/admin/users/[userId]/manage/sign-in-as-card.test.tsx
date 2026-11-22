/**
 * @file Tests for the "Sign in as user" card on the Manage tab of a user's page: it
 * opens a dialog with an optional reason when the rules allow it, says why
 * and keeps the button disabled when they don't, sends a staff member
 * without a recent strong confirmation to the step-up page in strong mode,
 * back to this card, and loads the dashboard afresh once it has started.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SignInAsCard from './sign-in-as-card';

/** Mocked server action, router and full page load. */
const { signInAsAction, push, loadFresh } = vi.hoisted(() => ({
  signInAsAction: vi.fn(),
  push: vi.fn(),
  loadFresh: vi.fn(),
}));

vi.mock('../actions', () => ({ signInAsAction }));

vi.mock('@/components/ui/load-fresh', () => ({ default: loadFresh }));

afterEach(() => {
  signInAsAction.mockReset();
  loadFresh.mockClear();
});

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `push` is recorded.
   */
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

/** The user's ID. */
const USER_ID = '01890a5d-ac96-774b-bcce-b302099a8057';

/**
 * Renders the card for Jane Doe, as a staff member with strong MFA.
 *
 * @param options - What to change.
 * @param options.verdict - Whether the rules allow it.
 * @param options.confirmedUntil - Until when the staff member's session is strongly confirmed.
 */
function renderCard({
  verdict = 'allowed',
  confirmedUntil = new Date(Date.now() + 10 * 60_000),
}: {
  verdict?: Parameters<typeof SignInAsCard>[0]['verdict'];
  confirmedUntil?: Date | null;
} = {}) {
  render(
    <SignInAsCard
      userId={USER_ID}
      userName="Jane Doe"
      verdict={verdict}
      strongMfa
      strongMfaConfirmedUntil={confirmedUntil}
      returnTo={`/admin/users/${USER_ID}`}
    />,
  );
}

describe('SignInAsCard', () => {
  it('opens a dialog with what happens and an optional reason', async () => {
    const user = userEvent.setup();
    renderCard();

    expect(screen.getByRole('heading', { name: 'Sign in as user' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in as user' }));

    const dialog = screen.getByRole('dialog', { name: 'Sign in as Jane Doe?' });
    expect(dialog).toHaveTextContent('for up to 30 minutes');
    expect(screen.getByRole('textbox', { name: 'Reason (optional)' })).toHaveAttribute(
      'maxlength',
      '200',
    );
    expect(screen.getByRole('button', { name: 'Sign in as Jane Doe' })).toBeEnabled();
  });

  it('loads the dashboard afresh, in every tab, once it has started, staying busy until it goes', async () => {
    signInAsAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Sign in as user' }));
    await user.click(screen.getByRole('button', { name: 'Sign in as Jane Doe' }));

    // The browser's other tabs load their own page afresh too, as the user.
    await waitFor(() => expect(loadFresh).toHaveBeenCalledWith('/dashboard', { everyTab: true }));
    expect(screen.getByRole('dialog', { name: 'Sign in as Jane Doe?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in as Jane Doe' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('stays in the dialog with the reason when it is refused', async () => {
    signInAsAction.mockResolvedValue({ ok: false, message: 'Too many attempts.' });
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Sign in as user' }));
    await user.click(screen.getByRole('button', { name: 'Sign in as Jane Doe' }));

    expect(await screen.findByText('Too many attempts.')).toBeInTheDocument();
    expect(loadFresh).not.toHaveBeenCalled();
  });

  it.each([
    ['company_admin', "Support can't sign in as a company Admin."],
    ['staff', 'Only staff Admins can sign in as staff.'],
    ['staff_admin', 'Nobody can sign in as a staff Admin.'],
    ['deactivated', 'This account is deactivated, so nobody can sign in as this user.'],
    ['opted_out', 'This user has turned off sign-ins by staff.'],
  ] as const)('says why it is refused for %s, with the button disabled', (verdict, reason) => {
    renderCard({ verdict });

    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in as user' })).toBeDisabled();
  });

  it('links to the Security page when the staff member needs strong MFA first', () => {
    renderCard({ verdict: 'needs_mfa' });

    expect(screen.getByRole('link', { name: 'Security page' })).toHaveAttribute(
      'href',
      '/account/security#passkeys',
    );
    expect(screen.getByRole('button', { name: 'Sign in as user' })).toBeDisabled();
  });

  it('sends a staff member without a recent strong confirmation to confirm first', async () => {
    const user = userEvent.setup();
    renderCard({ confirmedUntil: null });

    await user.click(screen.getByRole('button', { name: 'Sign in as user' }));

    expect(push).toHaveBeenCalledWith(
      `/auth/verify?callbackURL=${encodeURIComponent(`/admin/users/${USER_ID}#sign-in-as`)}&for=strong`,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
