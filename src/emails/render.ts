/**
 * @file Renders an email template to the HTML and plain-text versions that
 * are sent.
 */
import type { ReactElement } from 'react';
import { render } from 'react-email';

import type { Email } from '@/lib/email';

/**
 * How the plain-text version is written: links as "text https://…" (no
 * brackets, and the address only once when the text is the address itself)
 * and no images.
 */
const PLAIN_TEXT_OPTIONS = {
  selectors: [
    { selector: 'a', options: { linkBrackets: false as const, hideLinkHrefIfSameAsText: true } },
    { selector: 'img', format: 'skip' },
  ],
};

/**
 * Renders a template into an email with an HTML and a plain-text body.
 *
 * @param to - Recipient address.
 * @param subject - Subject line.
 * @param element - The rendered template, e.g. `<MagicLinkEmail … />`.
 * @returns The email, ready to send.
 */
export default async function renderEmail(
  to: string,
  subject: string,
  element: ReactElement,
): Promise<Email> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true, htmlToTextOptions: PLAIN_TEXT_OPTIONS }),
  ]);
  return { to, subject, html, text };
}
