/**
 * @file Button in the brand style, with variants, sizes and a busy state.
 */
import { Slot } from 'radix-ui';
import type { ComponentProps, MouseEvent } from 'react';

import cn from '@/lib/cn';

import Spinner from './spinner';
import { focusRing } from './styles';

/**
 * Classes per button style: `look` is how it appears at rest, `hover` how it
 * reacts to the pointer (left out for decorative buttons).
 */
const variantClasses = {
  /** The main action on a page or in a form. */
  primary: {
    look: 'bg-primary text-primary-foreground shadow-sm',
    hover: 'hover:bg-primary-hover',
  },
  /** Secondary actions. */
  secondary: {
    look: 'border border-border bg-surface text-foreground shadow-xs',
    hover: 'hover:bg-muted',
  },
  /** Low-emphasis actions, e.g. in toolbars and menus. */
  ghost: { look: 'text-foreground', hover: 'hover:bg-muted' },
  /** Destructive actions: the confirming button, or a page's single destructive action. */
  danger: {
    look: 'bg-danger text-danger-foreground shadow-sm',
    hover: 'hover:bg-danger-hover',
  },
  /** Destructive actions repeated in lists (e.g. "Remove" per row), quieter than `danger`. */
  'danger-subtle': {
    look: 'border border-border bg-surface text-danger shadow-xs',
    hover: 'hover:border-danger/40 hover:bg-danger-soft',
  },
} as const;

/**
 * Classes every button shares, interactive or not. A button is never wider
 * than its container (`max-w-full`): a label that fits stays on one line, and
 * a longer one (another language, a wider font, a "Last used" badge) wraps
 * onto a second line, growing the button from its usual height, instead of
 * running out of its card or making a narrow screen scroll sideways
 * (WCAG 1.4.10 Reflow). Every button carries `data-button`, which table cells
 * use to keep theirs on one line (see `Td`).
 */
const baseClasses =
  'inline-flex max-w-full shrink-0 items-center justify-center rounded-lg text-center font-medium text-balance select-none [&_svg]:size-4 [&_svg]:shrink-0';

/**
 * Classes per button size: a minimum height rather than a fixed one, so a
 * wrapped label grows the button. Small buttons still meet the 24px target
 * size.
 */
const sizeClasses = {
  sm: 'min-h-8 gap-1.5 px-3 py-1 text-sm',
  md: 'min-h-10 gap-2 px-4 py-1.5 text-sm',
} as const;

/** Classes for a full-width button: it stretches to its container. */
const fullWidthClasses = 'w-full';

/**
 * Props for {@link Button}.
 */
export type ButtonProps = ComponentProps<'button'> & {
  /** Visual style. Defaults to `primary`. */
  variant?: keyof typeof variantClasses;
  /** Size. Defaults to `md`. */
  size?: keyof typeof sizeClasses;
  /** Stretch to the container's width. */
  fullWidth?: boolean;
  /**
   * Show a spinner and ignore presses while an action runs. The button is
   * busy, not disabled, so it keeps keyboard focus (see {@link Button}).
   */
  loading?: boolean;
  /**
   * While `disabled`, stay focusable and ignore presses instead of being
   * disabled: `aria-disabled`, with the disabled look and cursor. For a
   * button that its own use makes wait, such as "Send a new code" counting
   * down after a code was sent, which would otherwise lose keyboard focus
   * the moment it's pressed (see {@link Button}).
   */
  focusableWhenDisabled?: boolean;
  /** Render the child element (e.g. a link) with the button's styles instead of a `<button>`. */
  asChild?: boolean;
  /**
   * Render a picture of a button for illustrations: a `<span>` with the
   * button's look but no hover, focus or press effects, which can't be
   * focused or clicked.
   */
  decorative?: boolean;
};

/**
 * The state of one of several buttons that each start an action, of which
 * only one may run at a time (e.g. "Sign in with a passkey", "Continue with
 * GitHub" and "Sign in"): the running action's button is busy, so it keeps
 * keyboard focus, and every other one is disabled, so it can't start a
 * second action. A single flag for all of them would disable the button
 * that was pressed, which loses focus, and show a spinner on buttons nobody
 * pressed.
 *
 * @param running - The action that's running, or `null` when none is.
 * @param action - This button's action.
 * @returns The `loading` and `disabled` props for this button.
 */
export function whileRunning<Action extends string>(
  running: Action | null,
  action: Action,
): Pick<ButtonProps, 'loading' | 'disabled'> {
  return { loading: running === action, disabled: running !== null && running !== action };
}

/**
 * Ignores a press on a busy button, or a disabled one that stays focusable
 * (`focusableWhenDisabled`): nothing is called, and a submit button
 * doesn't submit its form again (also not when Enter in one of the form's
 * fields presses it). Radix triggers skip their own handler for a prevented
 * press too.
 *
 * @param event - The click, also the one a key press or a form makes.
 */
function ignorePress(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/**
 * A button. Defaults to `type="button"` so it never submits a form by
 * accident; pass `type="submit"` for form buttons. While `loading`, it's
 * busy rather than disabled: marked `aria-busy` and `aria-disabled`, with a
 * spinner and the wait cursor, and it ignores presses, which prevents double
 * submissions. A disabled button would lose keyboard focus the moment the
 * action starts, and not get it back, leaving keyboard users at the top of
 * the page after every form they send. For the same reason, a button that
 * its own use makes wait (`focusableWhenDisabled`) is `aria-disabled` while
 * it's disabled, and ignores presses, rather than disabled. With
 * `decorative`, it's only a picture of a button (see the prop).
 *
 * @returns The button.
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  focusableWhenDisabled = false,
  asChild = false,
  decorative = false,
  className = '',
  type = 'button',
  disabled = false,
  onClick = undefined,
  children = null,
  ...props
}: ButtonProps) {
  if (decorative) {
    return (
      <span
        aria-hidden="true"
        data-button=""
        className={cn(
          baseClasses,
          'pointer-events-none cursor-default',
          variantClasses[variant].look,
          sizeClasses[size],
          fullWidth && fullWidthClasses,
          className,
        )}
      >
        {children}
      </span>
    );
  }

  const classes = cn(
    baseClasses,
    // A busy button, or a disabled one that stays focusable (`aria-disabled`), looks like a disabled one.
    'transition-[background-color,border-color,color,box-shadow,transform] active:scale-[0.98] disabled:opacity-55 disabled:active:scale-100 aria-disabled:opacity-55 aria-disabled:active:scale-100',
    focusRing,
    variantClasses[variant].look,
    variantClasses[variant].hover,
    sizeClasses[size],
    fullWidth && fullWidthClasses,
    className,
  );

  if (asChild) {
    return (
      <Slot.Root data-button="" className={classes} onClick={onClick} {...props}>
        {children}
      </Slot.Root>
    );
  }

  // Busy, or disabled but focusable: it keeps focus and ignores presses instead of being disabled.
  const ignoresPresses = loading || (disabled && focusableWhenDisabled);

  return (
    <button
      // eslint-disable-next-line react/button-has-type -- `type` defaults to "button" above.
      type={type}
      data-button=""
      className={classes}
      disabled={disabled && !focusableWhenDisabled}
      aria-busy={loading || undefined}
      aria-disabled={ignoresPresses || undefined}
      {...props}
      onClick={ignoresPresses ? ignorePress : onClick}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
