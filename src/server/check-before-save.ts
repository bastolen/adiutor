/**
 * @file Tries settings that reach another server (a storage, a mail server)
 * before they're saved, and refuses them by the kind of failure only: what
 * the server replied, an address or a secret is never shown or logged, so a
 * refusal can't leak what a server said or help probe what's behind it.
 */
import { type ErrorMessageKey, ServiceError } from './errors';

/**
 * Runs a test; a failure of a known kind becomes a refusal naming that kind
 * (`invalid`, with its message) and a warning in the log with the kind
 * alone. Anything else is thrown as it is.
 *
 * @param what - What's tried, for the log, e.g. "A storage".
 * @param test - The test (it writes, reads or connects, with its own time limits).
 * @param kindOf - The kind of a failure, or `null` for one it doesn't know.
 * @param refusal - The message for a kind of failure.
 * @throws {ServiceError} `invalid`, with the kind's message, when the test fails in a known way.
 */
export default async function checkBeforeSaving<K extends string>(
  what: string,
  test: () => Promise<void>,
  kindOf: (error: unknown) => K | null,
  refusal: (kind: K) => ErrorMessageKey,
): Promise<void> {
  try {
    await test();
  } catch (error) {
    const kind = kindOf(error);
    if (kind === null) {
      throw error;
    }
    // eslint-disable-next-line no-console -- The kind only: never the server's reply, an address or a secret.
    console.warn(`${what} failed its test before it was saved:`, kind);
    throw new ServiceError('invalid', refusal(kind));
  }
}
