/**
 * @file Checks a code the user entered, with the Better Auth endpoint for its
 * kind: the sign-in code step, the step-up page and the Security page's
 * setups all check codes through it. For Client Components; it loads the
 * auth client when a code is checked (`loadAuthClient`), so the Security
 * page doesn't download it with the page.
 */
import loadAuthClient from './load-auth-client';

/** What the user is entering: an authenticator app code, an emailed code, or a backup code. */
export type CodeKind = 'totp' | 'otp' | 'backup';

/** What a code check sends. */
export interface CodeInput {
  /** The code as typed; it's trimmed before it's sent. */
  code: string;
  /** Whether to trust this browser, so it skips the code step (the sign-in code step only). */
  trustDevice?: boolean;
}

/**
 * Checks a code with Better Auth's endpoint for its kind.
 *
 * @param kind - What the code is.
 * @param input - The code, and at sign-in whether to trust the browser.
 * @param input.code - The code as typed; it's trimmed before it's sent.
 * @param input.trustDevice - Whether to trust this browser (until 30 days after
 *   the last password sign-in there), when given.
 * @returns Better Auth's result, unchanged (`error` when the code was refused).
 */
export default async function verifyCode(kind: CodeKind, { code, trustDevice }: CodeInput) {
  const input = { code: code.trim(), ...(trustDevice === undefined ? {} : { trustDevice }) };
  const authClient = await loadAuthClient();
  if (kind === 'totp') {
    return authClient.twoFactor.verifyTotp(input);
  }
  if (kind === 'otp') {
    return authClient.twoFactor.verifyOtp(input);
  }
  return authClient.twoFactor.verifyBackupCode(input);
}
