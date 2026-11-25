/**
 * @file The `<account>` tag of the invite and join forms' sentences, in a
 * file without `'use client'` so both client forms can import it.
 */
import type { ReactNode } from 'react';

/**
 * Shows the signed-in account's address in a sentence, emphasised (the
 * `<account>` tag of `auth.invite.signedInAs` and `auth.join.joinAs`).
 *
 * @param chunks - The address, where the sentence places it.
 */
export default function accountTag(chunks: ReactNode) {
  return <span className="font-medium text-foreground">{chunks}</span>;
}
