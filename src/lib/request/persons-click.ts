/**
 * @file Tells a person's click on a link from a visit by a program, such as
 * a mail scanner that opens the links in an email to check them.
 */

/**
 * Checks whether a request is a navigation that a person caused: browsers
 * send `Sec-Fetch-User: ?1` only when someone clicked a link or typed the
 * address, never for a page's own fetches, prefetches, or programs that
 * fetch a link without a browser. Used by the links that act on a click
 * (an email's Approve and Deny buttons, decision 0033); a program that drives
 * a whole browser can still look like a person, which those links accept.
 *
 * @param headers - The request's headers.
 * @returns Whether a person clicked or typed the link.
 */
export default function isPersonsClick(headers: Headers): boolean {
  return headers.get('sec-fetch-user') === '?1';
}
