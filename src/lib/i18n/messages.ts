/**
 * @file The translation catalogues: one JSON file per area and language in
 * `src/messages/<locale>/`, merged here into one set per language.
 *
 * English (US) is the source: its keys give the {@link Messages} type that
 * next-intl checks every key against (`src/lib/i18n/app-config.ts`), and
 * {@link messagesFor} lays every other language over it, so a missing
 * translation shows English rather than a key (`pnpm lint:messages` keeps
 * them complete). Each file's top-level key is its namespace, e.g.
 * `{ "common": { ... } }` in `common.json`.
 *
 * Server only in practice: client components get their messages from the
 * root provider or `ClientMessages`, never from here
 * (`src/client-imports.test.ts`). See docs/i18n.md.
 */
import enUsAccount from '@/messages/en-US/account.json';
import enUsAudit from '@/messages/en-US/audit.json';
import enUsCommon from '@/messages/en-US/common.json';
import enUsEmails from '@/messages/en-US/emails.json';
import enUsRoles from '@/messages/en-US/roles.json';
import enUsTables from '@/messages/en-US/tables.json';
import esEsAccount from '@/messages/es-ES/account.json';
import esEsAudit from '@/messages/es-ES/audit.json';
import esEsCommon from '@/messages/es-ES/common.json';
import esEsEmails from '@/messages/es-ES/emails.json';
import esEsRoles from '@/messages/es-ES/roles.json';
import esEsTables from '@/messages/es-ES/tables.json';
import nlNlAccount from '@/messages/nl-NL/account.json';
import nlNlAudit from '@/messages/nl-NL/audit.json';
import nlNlCommon from '@/messages/nl-NL/common.json';
import nlNlEmails from '@/messages/nl-NL/emails.json';
import nlNlRoles from '@/messages/nl-NL/roles.json';
import nlNlTables from '@/messages/nl-NL/tables.json';

import type { Locale } from './locales';

/** Every English (US) message: the source the other languages translate. */
const EN_US = {
  ...enUsAccount,
  ...enUsAudit,
  ...enUsCommon,
  ...enUsEmails,
  ...enUsRoles,
  ...enUsTables,
};

/** Every message, in English (US): the shape all languages share. */
export type Messages = typeof EN_US;

/** A nested group of messages, as found in a catalogue. */
interface MessageTree {
  [key: string]: string | MessageTree;
}

/** Each language's own catalogues, before English fills any gap. */
const TRANSLATIONS: Record<Locale, MessageTree> = {
  'en-US': EN_US,
  'nl-NL': {
    ...nlNlAccount,
    ...nlNlAudit,
    ...nlNlCommon,
    ...nlNlEmails,
    ...nlNlRoles,
    ...nlNlTables,
  },
  'es-ES': {
    ...esEsAccount,
    ...esEsAudit,
    ...esEsCommon,
    ...esEsEmails,
    ...esEsRoles,
    ...esEsTables,
  },
};

/**
 * Lays one set of messages over another: every message in `over` replaces
 * the one at the same key in `base`, nested groups merge.
 *
 * @param base - The messages to fall back on.
 * @param over - The messages that win.
 * @returns The merged messages; neither argument changes.
 */
export function mergeMessages(base: MessageTree, over: MessageTree): MessageTree {
  const merged: MessageTree = { ...base };
  Object.entries(over).forEach(([key, value]) => {
    const below = merged[key];
    merged[key] =
      typeof value === 'object' && typeof below === 'object' ? mergeMessages(below, value) : value;
  });
  return merged;
}

/** Each language's messages with English filling any gap, built once. */
const MERGED = new Map<Locale, Messages>();

/**
 * Every message in a language, with English (US) wherever a translation is
 * missing.
 *
 * @param locale - The language.
 * @returns Its messages.
 */
export function messagesFor(locale: Locale): Messages {
  let messages = MERGED.get(locale);
  if (!messages) {
    // English keys are the shape every catalogue follows; the merge only fills gaps.
    messages = mergeMessages(EN_US, TRANSLATIONS[locale]) as Messages;
    MERGED.set(locale, messages);
  }
  return messages;
}

/**
 * Picks the namespaces a provider passes to the browser, so a page ships
 * only the text its client components use.
 *
 * @param messages - All messages in a language.
 * @param namespaces - The namespaces to keep.
 * @returns Just those namespaces.
 */
export function pickMessages(
  messages: Messages,
  namespaces: readonly (keyof Messages)[],
): Partial<Messages> {
  return Object.fromEntries(namespaces.map((namespace) => [namespace, messages[namespace]]));
}
