/**
 * @file Inline message for confirmations, errors and information, optionally
 * with a dismiss button.
 */
'use client';

import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

import cn from '@/lib/cn';

import Button from './button';
import restoreFocusIfLost from './focus-fallback';
import { useToast } from './toast';

/** Icon and classes per tone. */
const tones = {
  success: { icon: CircleCheck, classes: 'border-success/30 bg-success-soft text-success' },
  error: { icon: CircleAlert, classes: 'border-danger/30 bg-danger-soft text-danger' },
  info: { icon: Info, classes: 'border-border bg-muted text-foreground' },
} as const;

/**
 * Props for {@link Alert}.
 */
interface AlertProps {
  /** `success`, `error` or `info`. */
  tone: keyof typeof tones;
  /** The message. Nothing renders when it's empty. */
  children: ReactNode;
  /**
   * Move keyboard focus to the message when it appears, e.g. for an error
   * after a failed form submission, so the user lands on what went wrong.
   */
  focusOnShow?: boolean;
  /**
   * Called when the user dismisses the message; adds an icon-only dismiss
   * button on the right. The caller hides the message.
   */
  onDismiss?: () => void;
  /** The dismiss button's name for screen readers. Defaults to "Dismiss". */
  dismissLabel?: string;
  /**
   * Also show the message as a toast when it appears (in the signed-in app,
   * where a `Toaster` is mounted), e.g. for an error an action returned, which
   * the app shows inline and as a toast. Only text messages are toasted.
   */
  alsoToast?: boolean;
}

/**
 * A message with an icon. Errors use `role="alert"` and confirmations
 * `role="status"`, so screen readers announce them when they appear. With
 * `onDismiss`, a dismiss button sits on the right, tinted in the message's
 * colour.
 *
 * @param props - Alert props.
 * @param props.tone - Kind of message.
 * @param props.children - The message.
 * @param props.focusOnShow - Focus the message when it appears.
 * @param props.onDismiss - Called when dismissed; adds the dismiss button. Focus then moves to
 *   the card's heading or the main content (`restoreFocusIfLost`), not to `<body>`.
 * @param props.dismissLabel - The dismiss button's name.
 * @param props.alsoToast - Also show the message as a toast when it appears.
 * @returns The alert, or nothing when there's no message.
 */
export default function Alert({
  tone,
  children,
  focusOnShow = false,
  onDismiss = undefined,
  dismissLabel = 'Dismiss',
  alsoToast = false,
}: AlertProps) {
  const ref = useRef<HTMLDivElement>(null);
  const showToast = useToast();
  // The message last toasted; cleared when the message goes, so the same one shows again later.
  const toasted = useRef<string | null>(null);

  useEffect(() => {
    if (focusOnShow && children) {
      ref.current?.focus();
    }
  }, [focusOnShow, children]);

  useEffect(() => {
    if (!children) {
      toasted.current = null;
      return;
    }
    if (!alsoToast || !showToast || typeof children !== 'string' || toasted.current === children) {
      return;
    }
    toasted.current = children;
    showToast(children, { tone: tone === 'error' ? 'error' : 'success' });
  }, [alsoToast, children, showToast, tone]);

  if (!children) {
    return null;
  }
  const { icon: Icon, classes } = tones[tone];

  return (
    <div
      ref={ref}
      tabIndex={focusOnShow ? -1 : undefined}
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
        classes,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={dismissLabel}
          onClick={(event) => {
            // The message (and this button) goes away: focus moves on instead of to <body>.
            restoreFocusIfLost(event.currentTarget);
            onDismiss();
          }}
          // In the message's colour, with a hover tint that shows on every tone's background;
          // the negative margins keep a one-line message as tall as one without the button.
          className="-my-1.5 -mr-1.5 text-current hover:bg-current/10"
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
