/**
 * @file Class names shared by the UI components.
 */

/** The focus ring every interactive element shows when focused by keyboard. */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * Styles shared by text inputs and select triggers. The text is 16px
 * (`text-base`) on every device, never smaller: iOS Safari zooms the page in
 * when a field with smaller text gets focus. The line height stays 20px
 * (`leading-5`), so fields keep their height.
 */
export const fieldControl =
  'w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base leading-5 text-foreground shadow-xs transition-colors placeholder:text-muted-foreground hover:border-foreground/60 focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 disabled:bg-muted disabled:text-muted-foreground';

/**
 * The page's side gutter on a phone (16px, `px-4`), in pixels. Menus and
 * select lists keep at least this far from the screen's edges when they would
 * otherwise run off it (Radix's `collisionPadding`).
 */
export const SCREEN_GUTTER = 16;
