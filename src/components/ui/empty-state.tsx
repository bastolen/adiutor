/**
 * @file Placeholder shown when a list has nothing to show yet, and the
 * message of a whole page that has nothing to show (the app's 404 and error
 * pages).
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';

import IconTile from './icon-tile';

/**
 * Props for {@link EmptyState}.
 */
interface EmptyStateProps {
  /** Decorative icon. */
  icon: LucideIcon;
  /** Short title, e.g. "No companies yet". */
  title: string;
  /** What to do next. */
  description?: string;
  /** A button or link to get started. */
  action?: ReactNode;
  /** Element for the title; `h1` when the empty state is the whole page. Defaults to `p`. */
  titleAs?: 'p' | 'h1' | 'h2' | 'h3';
  /**
   * Ref to the title, to move focus to it (e.g. when an error replaces the
   * page). With it, the title can take focus from code (`tabIndex={-1}`),
   * but isn't in the tab order.
   */
  titleRef?: Ref<HTMLElement>;
  /** More content below the action, e.g. the reference of an error. */
  children?: ReactNode;
}

/**
 * A centred icon, title, description and optional action.
 *
 * @param props - Empty state props.
 * @param props.icon - Decorative icon.
 * @param props.title - Title.
 * @param props.description - Explanation.
 * @param props.action - Call to action.
 * @param props.titleAs - Element for the title.
 * @param props.titleRef - Ref to the title, which can then take focus.
 * @param props.children - More content below the action.
 * @returns The empty state.
 */
export default function EmptyState({
  icon,
  title,
  description = '',
  action = null,
  titleAs: Title = 'p',
  titleRef = undefined,
  children = null,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <IconTile icon={icon} />
      <div className="flex flex-col gap-1">
        <Title
          // Every element `titleAs` allows is an `HTMLElement`; TypeScript can't tell for the union.
          ref={titleRef as Ref<HTMLHeadingElement & HTMLParagraphElement>}
          tabIndex={titleRef ? -1 : undefined}
          className="text-sm font-medium text-foreground outline-none"
        >
          {title}
        </Title>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
      {children}
    </div>
  );
}
