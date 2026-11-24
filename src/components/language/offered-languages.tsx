/**
 * @file The languages Adiutor offers, for the language choices in the
 * browser: the corner menu, the account's Language card and the Email
 * language field (decision 0029). The root layout reads them with the
 * request's language (`requestLanguageSettings`) and hands them down here, so
 * no choice offers a language that's turned off.
 */
'use client';

import { createContext, type ReactNode, use } from 'react';

import { type Locale, LOCALES } from '@/lib/i18n/locales';

/** The offered languages; every language outside the provider (tests, before it renders). */
const OfferedLocalesContext = createContext<readonly Locale[]>(LOCALES);

/**
 * Hands the offered languages to the language choices below it.
 *
 * @param props - Provider props.
 * @param props.offered - The languages that are on, in the order of `LOCALES`.
 * @param props.children - The page.
 */
export function OfferedLanguagesProvider({
  offered,
  children,
}: {
  offered: readonly Locale[];
  children: ReactNode;
}) {
  return <OfferedLocalesContext value={offered}>{children}</OfferedLocalesContext>;
}

/**
 * The languages Adiutor offers, in menu order. With only one, there's
 * nothing to choose, and the language choices don't show.
 */
export function useOfferedLocales(): readonly Locale[] {
  return use(OfferedLocalesContext);
}
