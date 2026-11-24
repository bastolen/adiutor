/**
 * @file Lets a page use more of a wide screen than the rest of the app does.
 * The signed-in app's content stops growing at 1280px of screen (944px of
 * content), which suits settings, details and short tables. Some pages have
 * more to show in the room (decision 0043): a request, whose text gets it;
 * the boards of requests, whose lanes sit side by side; and the lists of
 * requests and users, whose tables get columns of their own for what sits
 * under each name at the usual width. A section whose tabs hold such a page
 * (a company's pages, Settings) wraps all its tabs in its layout, so its
 * header and tabs keep their place from tab to tab.
 */
import type { ReactNode } from 'react';

/**
 * A page that grows with the screen up to 1200px of content. From the width
 * at which the app's content would stop growing, it reaches past that
 * content's edges by the same amount on both sides, as far as the room next
 * to the menu allows, keeping the page's side gutter. Below that width, and
 * on a screen without room to spare, it's the width every page has. From
 * 1536px of screen (`2xl`) it always has its full 1200px, which is where a
 * table on it may show more columns.
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
