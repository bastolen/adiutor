/**
 * @file The mode a staff Admin keeps every page in, for client components
 * (decision 0053). The root layout reads it (`requestForcedTheme`), renders
 * it on `<html>` and hands it down here, so the theme choices in a page's
 * static shell (the corner button on signed-out pages, the account menu)
 * know to step aside.
 */
'use client';

import { createContext, type ReactNode, use } from 'react';

import type { ForcedTheme } from '@/lib/theme';

/** The mode every page is kept in; none (each person chooses) outside the provider. */
const ForcedThemeContext = createContext<ForcedTheme | null>(null);

/**
 * Hands the kept mode to the components below it.
 *
 * @param props - Provider props.
 * @param props.theme - The mode, or `null` while each person chooses.
 * @param props.children - The page.
 */
export function ForcedThemeProvider({
  theme,
  children,
}: {
  theme: ForcedTheme | null;
  children: ReactNode;
}) {
  return <ForcedThemeContext value={theme}>{children}</ForcedThemeContext>;
}

/**
 * The mode a staff Admin keeps every page in.
 *
 * @returns `light` or `dark`, or `null` while each person chooses.
 */
export function useForcedTheme(): ForcedTheme | null {
  return use(ForcedThemeContext);
}
