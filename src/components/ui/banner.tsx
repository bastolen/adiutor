/**
 * @file Banner: a calm, page-level message with an icon, a title, a
 * description and actions, e.g. a recommendation or a warning on the
 * dashboard. For a short message inside a form or card, use `Alert`.
 */
import { type LucideIcon, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import cn from '@/lib/cn';

import Button from './button';
import restoreFocusIfLost from './focus-fallback';

/** Classes of the icon's tinted square, per tone. */
const toneClasses = {
  /** No particular meaning. */
  neutral: 'bg-muted text-muted-foreground',
  /** Something good to do or that went well, e.g. a security recommendation. */
  success: 'bg-success-soft text-success',
  /** Something to look at soon. */
  warning: 'bg-warning-soft text-warning',
  /** Something wrong that needs action. */
  danger: 'bg-danger-soft text-danger',
} as const;

/**
 * Props for {@link Banner}.
 */
interface BannerProps {
  /** Names the banner (a region landmark) for screen readers, e.g. "Account security". */
  label: string;
  /** Decorative icon on the left. */
  icon: LucideIcon;
  /** Colour of the icon's square. Defaults to `neutral`. */
  tone?: keyof typeof toneClasses;
  /** The message in a few words. */
  title: ReactNode;
  /** What it means and what to do. */
  description: ReactNode;
  /** Buttons or links on the right, e.g. a `Button asChild` around a `Link`. */
  actions?: ReactNode;
  /**
   * Called when the user dismisses the banner; adds an icon-only dismiss
   * button after the actions. The caller hides the banner (and remembers the
   * dismissal where it should).
   */
  onDismiss?: () => void;
}

/**
 * A banner on a surface card: a tinted icon, a title with a description
 * below it, and actions on the right. When the text would get narrower than
 * 10rem (phones), the actions wrap below it, still on the right. It's a
 * `<section>` named by `label`, so screen readers can find it.
 *
 * It doesn't need the browser itself, so a server component can render it
 * (without `onDismiss`, which only a client component can pass).
 *
 * @param props - Banner props.
 * @param props.label - Name for screen readers.
 * @param props.icon - Decorative icon.
 * @param props.tone - Colour of the icon's square.
 * @param props.title - The message in a few words.
 * @param props.description - What it means and what to do.
 * @param props.actions - Buttons or links on the right.
 * @param props.onDismiss - Called when dismissed; adds the dismiss button. Focus then moves to
 *   the card's heading or the main content (`restoreFocusIfLost`), not to `<body>`.
 * @returns The banner.
 */
export default function Banner({
  label,
  icon: Icon,
  tone = 'neutral',
  title,
  description,
  actions = null,
  onDismiss = undefined,
}: BannerProps) {
  const t = useTranslations('common.actions');
  return (
    <section
      aria-label={label}
      className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-xs sm:flex-nowrap"
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg',
          toneClasses[tone],
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {(actions || onDismiss) && (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
          {onDismiss && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('dismiss')}
              onClick={(event) => {
                // The banner (and this button) goes away: focus moves on instead of to <body>.
                restoreFocusIfLost(event.currentTarget);
                onDismiss();
              }}
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
