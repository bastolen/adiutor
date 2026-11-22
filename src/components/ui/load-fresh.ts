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
 * Those changes reach the browser's other tabs too (`everyTab`), which load
 * their own page afresh. Whether this page has started such a load is
 * {@link freshLoadStarted}, for work that only the page replacing it should
 * do.
 */
'use client';

import { tellOtherTabs } from './acting-as-channel';

/** Options of {@link loadFresh}. */
export interface LoadFreshOptions {
  /**
   * Whether the browser acts as someone else now (signing in or out,
   * starting or ending a sign-in as a user), so every other tab of this
   * browser loads its own current page afresh too (`tellOtherTabs`, answered
   * by `ReloadWhenActingAsChanges`). Not for a change of language, which
   * only this tab made.
   */
  everyTab?: boolean;
}

/**
 * Whether {@link loadFresh} has started loading a page afresh in this tab.
 * Module state, so the page that loads starts with it unset.
 */
let started = false;

// A page the browser restores from its back/forward cache comes back with its scripts' state, this
// flag included: it's there again, not on its way out, so it starts without it like a new page.
if (typeof window !== 'undefined') {
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      started = false;
    }
  });
}

/**
 * Whether this page has started to load a page afresh (`loadFresh`), so it's
 * on its way out: work that would be cut off by the load, or that the page
 * replacing it does again, is better left to that page (like saving the
 * browser's time zone, `SaveBrowserTimeZone`). It stays set should the load
 * be stopped (the page stays, and the next full load starts without it), and
 * it's unset again when the browser restores the page from its back/forward
 * cache (Back after the load), since the page is there again then.
 *
 * @returns Whether a fresh load has started.
 */
export function freshLoadStarted(): boolean {
  return started;
}

/**
 * The address of the current page, with its search and section.
 *
 * @returns E.g. `/companies/adiutor/members?page=2#members`.
 */
export function currentPage(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

/**
 * Loads the address afresh, as a full page load that leaves no entry for the
 * page it leaves (like the `router.replace` it stands in for). Another page
 * (another path or search) loads with `location.replace`, so the address
 * changes only once that page arrives: nothing watching the address, an
 * end-to-end test included, takes the old page for the new one while the
 * load is still on its way. The same page (only its `#section` differs, or
 * the same address, as for a change of language) can't load that way, since
 * the browser would only scroll: there the address is replaced (keeping the
 * router's history state) and the page reloads. With `everyTab`, the
 * browser's other tabs are told first, once the change is made, so they
 * load as the new person. From then on {@link freshLoadStarted} says so.
 *
 * It returns at once, while the page is still there: a caller that shows a
 * busy button keeps it busy with state of its own until the page goes. (A
 * promise that never settles would hold up every other transition on the
 * page, which React runs together, should the load be stopped.)
 *
 * @param url - The page of the app to load, e.g. `/dashboard` or `/account/preferences#language`.
 * @param options - See {@link LoadFreshOptions}.
 * @param options.everyTab - Whether the browser's other tabs load their page afresh too.
 */
export default function loadFresh(url: string, { everyTab = false }: LoadFreshOptions = {}): void {
  started = true;
  if (everyTab) {
    tellOtherTabs();
  }
  const target = new URL(url, window.location.href);
  if (target.pathname === window.location.pathname && target.search === window.location.search) {
    window.history.replaceState(window.history.state, '', url);
    window.location.reload();
    return;
  }
  window.location.replace(url);
}
