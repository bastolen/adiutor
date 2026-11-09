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
import type { NamespaceKeys, NestedKeyOf } from 'use-intl/core';

import enUsAccount from '@/messages/en-US/account.json';
import enUsAdmin from '@/messages/en-US/admin.json';
import enUsAudit from '@/messages/en-US/audit.json';
import enUsAuth from '@/messages/en-US/auth.json';
import enUsCommon from '@/messages/en-US/common.json';
import enUsCompanies from '@/messages/en-US/companies.json';
import enUsDashboard from '@/messages/en-US/dashboard.json';
import enUsEmails from '@/messages/en-US/emails.json';
import enUsErrors from '@/messages/en-US/errors.json';
import enUsNavigation from '@/messages/en-US/navigation.json';
import enUsPeople from '@/messages/en-US/people.json';
import enUsRoles from '@/messages/en-US/roles.json';
import enUsTables from '@/messages/en-US/tables.json';
import enUsValidation from '@/messages/en-US/validation.json';
import esEsAccount from '@/messages/es-ES/account.json';
import esEsAdmin from '@/messages/es-ES/admin.json';
import esEsAudit from '@/messages/es-ES/audit.json';
import esEsAuth from '@/messages/es-ES/auth.json';
import esEsCommon from '@/messages/es-ES/common.json';
import esEsCompanies from '@/messages/es-ES/companies.json';
import esEsDashboard from '@/messages/es-ES/dashboard.json';
import esEsEmails from '@/messages/es-ES/emails.json';
import esEsErrors from '@/messages/es-ES/errors.json';
import esEsNavigation from '@/messages/es-ES/navigation.json';
import esEsPeople from '@/messages/es-ES/people.json';
import esEsRoles from '@/messages/es-ES/roles.json';
import esEsTables from '@/messages/es-ES/tables.json';
import esEsValidation from '@/messages/es-ES/validation.json';
import nlNlAccount from '@/messages/nl-NL/account.json';
import nlNlAdmin from '@/messages/nl-NL/admin.json';
import nlNlAudit from '@/messages/nl-NL/audit.json';
import nlNlAuth from '@/messages/nl-NL/auth.json';
import nlNlCommon from '@/messages/nl-NL/common.json';
import nlNlCompanies from '@/messages/nl-NL/companies.json';
import nlNlDashboard from '@/messages/nl-NL/dashboard.json';
import nlNlEmails from '@/messages/nl-NL/emails.json';
import nlNlErrors from '@/messages/nl-NL/errors.json';
import nlNlNavigation from '@/messages/nl-NL/navigation.json';
import nlNlPeople from '@/messages/nl-NL/people.json';
import nlNlRoles from '@/messages/nl-NL/roles.json';
import nlNlTables from '@/messages/nl-NL/tables.json';
import nlNlValidation from '@/messages/nl-NL/validation.json';

import type { Locale } from './locales';

/** Every English (US) message: the source the other languages translate. */
const EN_US = {
  ...enUsAccount,
  ...enUsAdmin,
  ...enUsAudit,
  ...enUsAuth,
  ...enUsCommon,
  ...enUsCompanies,
  ...enUsDashboard,
  ...enUsEmails,
  ...enUsErrors,
  ...enUsNavigation,
  ...enUsPeople,
  ...enUsRoles,
  ...enUsTables,
  ...enUsValidation,
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
    ...nlNlAdmin,
    ...nlNlAudit,
    ...nlNlAuth,
    ...nlNlCommon,
    ...nlNlCompanies,
    ...nlNlDashboard,
    ...nlNlEmails,
    ...nlNlErrors,
    ...nlNlNavigation,
    ...nlNlPeople,
    ...nlNlRoles,
    ...nlNlTables,
    ...nlNlValidation,
  },
  'es-ES': {
    ...esEsAccount,
    ...esEsAdmin,
    ...esEsAudit,
    ...esEsAuth,
    ...esEsCommon,
    ...esEsCompanies,
    ...esEsDashboard,
    ...esEsEmails,
    ...esEsErrors,
    ...esEsNavigation,
    ...esEsPeople,
    ...esEsRoles,
    ...esEsTables,
    ...esEsValidation,
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
 * A namespace, or a group of messages inside one, that a provider can pass to
 * the browser: `admin` or just `admin.staff.name`.
 */
export type MessagesGroup = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

/**
 * Picks the namespaces (or groups inside them) a provider passes to the
 * browser, so a page ships only the text its client components use. A group
 * keeps its place, so `admin.staff.name` gives `{ admin: { staff: { name } } }`
 * and `useTranslations('admin.staff.name')` finds it.
 *
 * @param messages - All messages in a language.
 * @param namespaces - The namespaces or groups to keep, e.g. `common` or `admin.staff.name`.
 * @returns Just those messages.
 */
export function pickMessages(
  messages: Messages,
  namespaces: readonly MessagesGroup[],
): Partial<Messages> {
  const picked = namespaces.reduce<MessageTree>((kept, namespace) => {
    const path = namespace.split('.');
    const group = path.reduce<string | MessageTree | undefined>(
      (tree, part) => (typeof tree === 'object' ? tree[part] : undefined),
      messages,
    );
    if (group === undefined) {
      return kept;
    }
    const placed = path.reduceRight<string | MessageTree>(
      (inner, part) => ({ [part]: inner }),
      group,
    );
    return typeof placed === 'object' ? mergeMessages(kept, placed) : kept;
  }, {});
  // The groups come from `Messages` itself, so what's kept has its shape.
  return picked;
}
