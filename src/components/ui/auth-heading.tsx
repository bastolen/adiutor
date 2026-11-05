/**
 * @file The title and explanation at the top of a single-column screen such as
 * sign in, setup or a link page.
 */
import type { ReactNode } from 'react';

/**
 * Props for {@link AuthHeading}.
 */
interface AuthHeadingProps {
  /** The screen's `h1`. */
  title: ReactNode;
  /** Short explanation below the title. */
  description: ReactNode;
}

/**
 * The screen's only `h1`, with a short explanation below it. Pages with
 * actions, a back link or an avatar use {@link PageHeader} instead.
 *
 * @param props - Heading props.
 * @param props.title - The title.
 * @param props.description - Short explanation.
 * @returns The heading block.
 */
export default function AuthHeading({ title, description }: AuthHeadingProps) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
