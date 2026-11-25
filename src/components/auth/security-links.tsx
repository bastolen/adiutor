/**
 * @file Links to the reader's own Security page inside a sentence: the
 * renderers of a rich message's link tag (`t.rich`), for the notices and
 * hints that send someone there to connect an account or set up a second
 * step. Defined outside the components, so React never sees a new component
 * type on a render.
 */
import type { ReactNode } from 'react';

import TextLink from '@/components/ui/text-link';
import { SECURITY_PAGE } from '@/lib/redirect';

/**
 * Renders a message's link tag as a link to the reader's Security page.
 *
 * @param chunks - The link's text, where the sentence places it.
 */
export function securityLink(chunks: ReactNode) {
  return <TextLink href={SECURITY_PAGE}>{chunks}</TextLink>;
}

/**
 * Renders a message's link tag as a link to the Passkeys card of the
 * reader's Security page.
 *
 * @param chunks - The link's text, where the sentence places it.
 */
export function passkeysLink(chunks: ReactNode) {
  return <TextLink href={`${SECURITY_PAGE}#passkeys`}>{chunks}</TextLink>;
}
