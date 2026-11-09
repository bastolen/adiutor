/**
 * @file Renderers for the tags in the `people` messages that `t.rich` fills
 * in: text only screen readers hear (`<hidden>…</hidden>`) and a relative
 * time (`<time></time>`). Defined outside the components, so React never
 * sees a new component type on a render.
 */
import type { ReactNode } from 'react';

import RelativeTime from '@/components/ui/relative-time';

/**
 * Renders a message's `<hidden>` tag: text for screen readers only, e.g. the
 * "Last active:" before a time in a column that doesn't say it.
 *
 * @param chunks - The tag's text.
 * @returns The visually hidden text.
 */
export function hiddenTag(chunks: ReactNode) {
  return <span className="sr-only">{chunks}</span>;
}

/**
 * Makes the renderer of a message's `<time></time>` tag: when something
 * happened, as relative time (`RelativeTime`).
 *
 * @param date - The moment, or `null` if it never happened.
 * @returns The renderer `t.rich` takes for the tag.
 */
export function timeTag(date: Date | null) {
  return function TimeTag() {
    return <RelativeTime date={date} />;
  };
}
