/**
 * @file Lets a page use more of a wide screen than the rest of the app does.
 * The signed-in app's content stops growing at 1280px of screen (944px of
 * content), which suits lists and settings. A page that's mostly text to
 * read and write, such as a request, has more room to give that text, and
 * so does the board of requests, whose lanes sit side by side.
 */
import type { ReactNode } from 'react';

/**
 * A page that grows with the screen up to 1200px of content (measured as
 * the 944px above, without the page's gutters). From the width
 * at which the app's content would stop growing, it reaches past that
 * content's edges by the same amount on both sides, as far as the room next
 * to the menu allows, keeping the page's side gutter. Below that width, and
 * on a screen without room to spare, it's the width every page has.
 *
 * It measures the room in the app layout's content column (a container, see
 * `src/app/(app)/layout.tsx`), not the screen, so a scrollbar never makes
 * the page scroll sideways. Its children are spaced like the content
 * column's own.
 *
 * @param props - Component props.
 * @param props.children - The page: its header and what follows.
 * @returns The page's wrapper.
 */
export default function WidePage({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8 xl:mx-[calc((100%_-_min(75rem,_100cqw_-_5rem))_/_2)]">
      {children}
    </div>
  );
}
