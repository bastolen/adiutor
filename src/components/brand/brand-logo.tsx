/**
 * @file The logo a staff Admin uploaded, for client components (decision
 * 0052). The root layout reads it (`requestBrandImages`) and hands it down
 * here, like the staff's name, so the logo in a page's static shell (the
 * sidebar, the sign-in pages) can show it.
 */
'use client';

import { createContext, type ReactNode, use } from 'react';

import type { BrandLogo } from '@/lib/branding';

/** The uploaded logo; none (Adiutor's) outside the provider (tests, before it renders). */
const BrandLogoContext = createContext<BrandLogo | null>(null);

/**
 * Hands the uploaded logo to the components below it.
 *
 * @param props - Provider props.
 * @param props.logo - The logo, or `null` for Adiutor's.
 * @param props.children - The page.
 */
export function BrandLogoProvider({
  logo,
  children,
}: {
  logo: BrandLogo | null;
  children: ReactNode;
}) {
  return <BrandLogoContext value={logo}>{children}</BrandLogoContext>;
}

/**
 * The logo a staff Admin uploaded.
 *
 * @returns Its address and size, or `null` while it's Adiutor's.
 */
export function useBrandLogo(): BrandLogo | null {
  return use(BrandLogoContext);
}
