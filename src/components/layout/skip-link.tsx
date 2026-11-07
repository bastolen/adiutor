/**
 * @file "Skip to main content" link: the first thing keyboard users reach.
 */

/**
 * A link that's hidden until focused, then jumps to `<main id="main">`, so
 * keyboard and screen reader users can skip the navigation.
 *
 * @returns The skip link.
 */
export default function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-lg bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-lg ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60]"
    >
      Skip to main content
    </a>
  );
}
