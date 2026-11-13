/**
 * @file Loads a page of the app afresh, as a full page load instead of a
 * navigation within the app. With Cache Components, Next.js keeps the last
 * few pages alive in React's `<Activity>` and keeps the router's cache, so
 * after a navigation their state, the values in their fields included, is
 * still there. That's right while the same person browses, but not once
 * something every page depends on changes: a full load starts the browser's
 * copy of the app over. Used when the language changes, and whenever the
 * browser starts acting as someone else (signing in or out, starting or
 * ending a sign-in as a user), so no page shows the previous person's values.
 */
'use client';

/**
 * Loads the address afresh: replaces the current address with it (keeping
 * the router's history state) and reloads. Reloading works even when only
 * the `#section` differs from the current address, where `location.assign`
 * would only scroll. Replacing, like the `router.replace` it stands in for,
 * leaves no entry for the page it leaves.
 *
 * It returns at once, while the page is still there: a caller that shows a
 * busy button keeps it busy with state of its own until the page goes. (A
 * promise that never settles would hold up every other transition on the
 * page, which React runs together, should the reload be stopped.)
 *
 * @param url - The page of the app to load, e.g. `/dashboard` or `/account#language`.
 */
export default function loadFresh(url: string): void {
  window.history.replaceState(window.history.state, '', url);
  window.location.reload();
}
