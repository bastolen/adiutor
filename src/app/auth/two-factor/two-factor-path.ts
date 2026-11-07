/**
 * @file Builds and reads the URL of the second sign-in step.
 */
import { allowsEmailCodesAtSignIn } from '@/lib/authz/mfa';

/** Ways to enter the second step: an authenticator app code or an emailed code. */
const TWO_FACTOR_METHODS = ['totp', 'otp'] as const;

/** One of {@link TWO_FACTOR_METHODS}. */
export type TwoFactorMethod = (typeof TWO_FACTOR_METHODS)[number];

/**
 * The URL of the code step, keeping where to go afterwards and which methods
 * the user has.
 *
 * @param callbackURL - Where to go after the code is accepted (a safe local path).
 * @param methods - The methods Better Auth reported for the user.
 * @returns The URL.
 */
export function twoFactorPath(callbackURL: string, methods: readonly string[]): string {
  const params = new URLSearchParams({ callbackURL });
  const known = methods.filter((method): method is TwoFactorMethod =>
    TWO_FACTOR_METHODS.includes(method as TwoFactorMethod),
  );
  if (known.length > 0) {
    params.set('methods', known.join(','));
  }
  return `/auth/two-factor?${params.toString()}`;
}

/**
 * Reads the method of the code step from its URL. Unknown values are
 * ignored; without any, email codes are assumed. With an authenticator app,
 * only it is offered, since email codes aren't accepted then
 * (`allowsEmailCodesAtSignIn`).
 *
 * @param value - The `methods` query parameter.
 * @returns The method to ask for.
 */
export function parseTwoFactorMethod(value: string | null): TwoFactorMethod {
  const authenticator = (value ?? '').split(',').includes('totp');
  return allowsEmailCodesAtSignIn({ authenticator }) ? 'otp' : 'totp';
}
