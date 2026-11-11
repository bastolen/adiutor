/**
 * @file Keeps keyboard focus somewhere sensible when the control that had it
 * goes away: after a row action removes its row, a button swaps for another,
 * two-step verification is turned off, or a notice is dismissed. Without
 * this, focus falls to `<body>` and keyboard users start again at the top of
 * the page.
 */

/** How many frames to keep watching (about two seconds), e.g. while a dialog closes. */
const WATCH_FRAMES = 120;

/**
 * Checks whether an element takes up space on the page: not hidden, and not
 * on a page React's `<Activity>` keeps in the background.
 *
 * @param element - The element.
 * @returns Whether it's shown.
 */
export function isShown(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * Checks whether keyboard focus is nowhere in particular: on `<body>`, or on
 * an element that's gone or no longer shown (e.g. the button on the page the
 * user just left, which `<Activity>` keeps hidden).
 *
 * @returns Whether it is.
 */
export function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected || !isShown(active);
}

/**
 * Where focus should go when a control inside `from` disappears: the heading
 * of the card it's in (`data-card-heading`, focusable with `tabIndex={-1}`),
 * or the page's main content (`<main id="main">`) outside a card.
 *
 * @param from - The control, or what contains it.
 * @returns The element to focus, if any.
 */
function fallbackFor(from: Element | null): HTMLElement | null {
  const heading = from?.closest('[data-card]')?.querySelector<HTMLElement>('[data-card-heading]');
  return heading ?? document.getElementById('main');
}

/**
 * Watches focus for a moment after a change that may remove the control in
 * `from`, and if focus falls to `<body>`, moves it to that control's card
 * heading (or the main content). It leaves focus alone while it's still on
 * the control (which may stay, e.g. after "Resend") or in a closing dialog,
 * and stops once focus is somewhere else on purpose. Call it while `from` is
 * still in the page, e.g. in an unmount cleanup or before a dismissal.
 *
 * @param from - The control, or what contains it.
 */
export default function restoreFocusIfLost(from: Element | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  const target = fallbackFor(from);
  let framesLeft = WATCH_FRAMES;

  /** Checks where focus is, once per frame. */
  const check = () => {
    const active = document.activeElement;
    if (!active || focusIsLost()) {
      // The card itself may be gone too: the main content is always there.
      (target?.isConnected ? target : document.getElementById('main'))?.focus();
      return;
    }
    const stillWaiting =
      (from?.isConnected && from.contains(active)) ||
      active.closest('[role="dialog"], [role="alertdialog"]') !== null;
    framesLeft -= 1;
    if (stillWaiting && framesLeft > 0) {
      requestAnimationFrame(check);
    }
  };
  requestAnimationFrame(check);
}
