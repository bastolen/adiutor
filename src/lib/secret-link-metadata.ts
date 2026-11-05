/**
 * @file Metadata for pages whose URL holds a secret token (invitations,
 * invite links, sign-in links, password resets). Pure and client-safe.
 */
import type { Metadata } from 'next';

/**
 * Metadata for pages whose URL contains a secret token: never send the URL to
 * other sites as a referrer, and keep the pages out of search engines.
 */
const secretLinkMetadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
} as const satisfies Metadata;

export default secretLinkMetadata;
