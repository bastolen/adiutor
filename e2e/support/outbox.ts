/**
 * @file Reads emails the test server wrote to the outbox folder.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { OUTBOX_DIR } from './fixtures';
import { defined } from '../../src/lib/defined';

/** An email as written to the outbox. */
export interface OutboxEmail {
  /** Recipient address. */
  to: string;
  /** Subject line. */
  subject: string;
  /** Plain-text body. */
  text: string;
  /** HTML body. */
  html: string;
}

/**
 * Reads every email in the outbox, oldest first.
 *
 * @returns The emails.
 */
async function readOutbox(): Promise<OutboxEmail[]> {
  const files = await readdir(OUTBOX_DIR).catch(() => []);
  const emails = await Promise.all(
    files
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map(
        async (file) => JSON.parse(await readFile(join(OUTBOX_DIR, file), 'utf8')) as OutboxEmail,
      ),
  );
  return emails;
}

/**
 * Waits for the newest email to an address and returns it. It returns an
 * email that's already there at once, so use it only for the first email to
 * a fresh address. For a seeded or reused address, count with
 * {@link countEmails} before the action and wait with
 * {@link waitForNewEmail}, so an earlier email (from a retry or an earlier
 * step) can't pass for the new one.
 *
 * @param to - The recipient address.
 * @returns The newest email to that address.
 */
export async function waitForEmail(to: string): Promise<OutboxEmail> {
  let found: OutboxEmail | undefined;
  await expect
    .poll(async () => {
      found = (await readOutbox()).filter((email) => email.to === to).at(-1);
      return found;
    })
    .toBeDefined();
  return defined(found, `an email to ${to}`);
}

/**
 * Counts the emails sent to an address so far.
 *
 * @param to - The recipient address.
 * @returns How many there are.
 */
export async function countEmails(to: string): Promise<number> {
  return (await readOutbox()).filter((email) => email.to === to).length;
}

/**
 * Waits for an email to an address that's newer than the ones counted
 * before, and returns the newest.
 *
 * @param to - The recipient address.
 * @param countBefore - How many emails to that address there were before.
 * @returns The newest email to that address.
 */
export async function waitForNewEmail(to: string, countBefore: number): Promise<OutboxEmail> {
  await expect.poll(() => countEmails(to)).toBeGreaterThan(countBefore);
  return waitForEmail(to);
}

/**
 * Extracts the 6-digit code from a sign-in code email.
 *
 * @param email - The email.
 * @returns The code.
 */
export function codeIn(email: OutboxEmail): string {
  const match = email.text.match(/\b\d{6}\b/);
  if (!match) {
    throw new Error(`No code in email: ${email.subject}`);
  }
  return match[0];
}

/**
 * Extracts the first link to this app from an email.
 *
 * @param email - The email.
 * @returns The link.
 */
export function linkIn(email: OutboxEmail): string {
  const match = email.text.match(/https?:\/\/\S+/);
  if (!match) {
    throw new Error(`No link in email: ${email.subject}`);
  }
  return match[0];
}
