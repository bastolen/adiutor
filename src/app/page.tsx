/**
 * @file Home page, served at `/`. Sends signed-in users to their dashboard;
 * the proxy has already sent everyone else to sign in.
 */
import { redirect } from 'next/navigation';

/**
 * Redirects to the dashboard.
 */
export default function Home() {
  redirect('/dashboard');
}
