/**
 * @file The heading block at the top of a page.
 */
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { focusRing } from './styles';

/**
 * Props for {@link PageHeader}.
 */
interface PageHeaderProps {
  /** The page's `h1`. */
  title: ReactNode;
  /** Short explanation below the title. */
  description?: ReactNode;
  /** Controls shown on the right, e.g. a primary button. */
  actions?: ReactNode;
  /** A link back to the parent page. */
  back?: { href: string; label: string };
  /** Content shown before the title, e.g. an avatar. */
  leading?: ReactNode;
  /** Content shown below the title row, e.g. badges or tabs. */
  children?: ReactNode;
}

/**
 * The page title (the page's only `h1`), with optional description, actions
 * and back link. The actions sit to the right of the title while it keeps
 * room to read (10rem), and below it on narrower screens.
 *
 * @param props - Header props.
 * @param props.title - The title.
 * @param props.description - Short explanation.
 * @param props.actions - Controls on the right.
 * @param props.back - Back link.
 * @param props.leading - Content before the title.
 * @param props.children - Content below the title row.
 * @returns The header.
 */
export default function PageHeader({
  title,
  description = null,
  actions = null,
  back = undefined,
  leading = null,
  children = null,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4">
      {back && (
        <Link
          href={back.href}
          // 2px above and below the text, cancelled by the margin: at least 24px to tap, nothing moves.
          className={`-my-0.5 inline-flex w-fit items-center gap-1.5 rounded-md py-0.5 text-sm text-muted-foreground hover:text-foreground ${focusRing}`}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-center gap-4">
        {leading}
        {/* At least 10rem wide before it shrinks: with less room than that, the actions move below instead of squeezing the title into a column. */}
        <div className="flex min-w-0 grow basis-40 flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
