/**
 * @file Home page, served at `/`. Sends signed-in users to their dashboard;
 * the proxy has already sent everyone else to sign in.
 */
import { redirect } from 'next/navigation';

import { DEFAULT_SIGNED_IN_PATH } from '@/lib/redirect';

/**
 * Redirects to the dashboard.
 */
export default function Home() {
  redirect(DEFAULT_SIGNED_IN_PATH);
}
