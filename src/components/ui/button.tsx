/**
 * @file Button in the brand style, with variants, sizes and a busy state.
 */
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

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
 * (WCAG 1.4.10 Reflow).
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
  /** Show a spinner and block clicks while an action runs. */
  loading?: boolean;
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
 * A button. Defaults to `type="button"` so it never submits a form by
 * accident; pass `type="submit"` for form buttons. While `loading`, it's
 * disabled and marked `aria-busy`, which prevents double submissions. With
 * `decorative`, it's only a picture of a button (see the prop).
 *
 * @param props - Button props.
 * @param props.variant - Visual style.
 * @param props.size - Size.
 * @param props.fullWidth - Stretch to the container's width.
 * @param props.loading - Busy state.
 * @param props.asChild - Style the child element instead of rendering a button.
 * @param props.decorative - Render a non-interactive look-alike.
 * @param props.className - Extra classes.
 * @param props.type - Button type.
 * @param props.disabled - Disabled state.
 * @param props.children - Content.
 * @returns The button.
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  asChild = false,
  decorative = false,
  className = '',
  type = 'button',
  disabled = false,
  children = null,
  ...props
}: ButtonProps) {
  if (decorative) {
    return (
      <span
        aria-hidden="true"
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
    'transition-[background-color,border-color,color,box-shadow,transform] active:scale-[0.98] disabled:opacity-55 disabled:active:scale-100',
    focusRing,
    variantClasses[variant].look,
    variantClasses[variant].hover,
    sizeClasses[size],
    fullWidth && fullWidthClasses,
    className,
  );

  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      // eslint-disable-next-line react/button-has-type -- `type` defaults to "button" above.
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
