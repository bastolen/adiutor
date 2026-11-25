/**
 * @file Renderers for the tags that `t.rich` fills in, in the `people`,
 * `admin` and `account` messages: text only screen readers hear
 * (`<hidden>…</hidden>`), a relative time (`<time></time>`) and a link to a
 * user's page (`<link>…</link>`). Defined outside the components, so React
 * never sees a new component type on a render.
 */
import type { ReactNode } from 'react';

import RelativeTime from '@/components/ui/relative-time';
import TextLink from '@/components/ui/text-link';

/**
 * Renders a message's `<hidden>` tag: text for screen readers only, e.g. the
 * "Last active:" before a time in a column that doesn't say it.
 *
 * @param chunks - The tag's text.
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

/**
 * Makes the renderer of a rich message's `<link>` tag: a link, inside the
 * sentence, to a user's page.
 *
 * @param userId - The user's ID.
 * @returns The renderer `t.rich` takes for the tag.
 */
export function userLink(userId: string) {
  return function UserLink(chunks: ReactNode) {
    return <TextLink href={`/admin/users/${userId}`}>{chunks}</TextLink>;
  };
}
