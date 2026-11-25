/**
 * @file Tests for the refusal hook of the Security page: a refusal for lack of
 * a recent confirmation sends the user to confirm and has no text; any other
 * refusal is worded in the user's language.
 */
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import confirmChangeUrl from '@/lib/sign-in/confirm-url';
import { MFA_VERIFICATION_REQUIRED } from '@/lib/sign-in/sign-in-refusals';

import ConfirmationWindow from '../../../../../tests/ui/confirmation-window';
import useRefusalText from './use-refusal-text';

/** Mocked router. */
const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `push` is recorded.
   */
  useRouter: () => ({ push }),
}));

/**
 * Wraps the hook in the provider the Security page renders.
 *
 * @param props - Wrapper props.
 * @param props.children - The hook's host.
 * @returns The provider.
 */
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ConfirmationWindow windowOpen={false} returnTo="/account/security">
      {children}
    </ConfirmationWindow>
  );
}

describe('useRefusalText', () => {
  beforeEach(() => {
    push.mockReset();
  });

  it('sends the user to confirm and gives no text when a confirmation is missing', () => {
    const { result } = renderHook(() => useRefusalText(), { wrapper: Wrapper });

    const text = result.current({ code: MFA_VERIFICATION_REQUIRED.code, status: 403 });

    expect(text).toBeNull();
    expect(push).toHaveBeenCalledWith(confirmChangeUrl('/account/security'));
  });

  it('words any other refusal and keeps the user where they are', () => {
    const { result } = renderHook(() => useRefusalText(), { wrapper: Wrapper });

    const text = result.current({ code: 'SOMETHING_UNKNOWN', status: 400 });

    expect(text).toEqual(expect.any(String));
    expect(text).not.toBe('');
    expect(push).not.toHaveBeenCalled();
  });
});
