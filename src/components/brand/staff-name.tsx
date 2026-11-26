/**
 * @file The staff's name for client components (decision 0050): the name
 * every text shows instead of "Adiutor". The root layout reads it
 * (`requestStaffName`) and hands it down here, so text in a page's static
 * shell can name it too, like the sign-in pages' home link and the corner
 * menu.
 */
'use client';

import { createContext, type ReactNode, use } from 'react';

import { ADIUTOR_NAME } from '@/lib/branding';

/** The staff's name; Adiutor's outside the provider (tests, before it renders). */
const StaffNameContext = createContext<string>(ADIUTOR_NAME);

/**
 * Hands the staff's name to the components below it.
 *
 * @param props - Provider props.
 * @param props.name - The staff's name.
 * @param props.children - The page.
 */
export function StaffNameProvider({ name, children }: { name: string; children: ReactNode }) {
  return <StaffNameContext value={name}>{children}</StaffNameContext>;
}

/**
 * The staff's name, e.g. "Acme Support", for a message's `{staff}` argument.
 *
 * @returns The name; "Adiutor" before setup names the staff.
 */
export function useStaffName(): string {
  return use(StaffNameContext);
}
