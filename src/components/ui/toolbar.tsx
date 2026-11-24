/**
 * @file A toolbar: a row of buttons that act on what's next to them, such as
 * the formatting of an editor. It's one stop for the Tab key: the arrow keys
 * move between its buttons, and Tab leaves it (Radix Toolbar).
 */
'use client';

import { ChevronDown, type LucideIcon } from 'lucide-react';
import { Toolbar as RadixToolbar } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import cn from '@/lib/cn';

import { focusRing } from './styles';

/**
 * Classes of a toolbar's button: a square with an icon. One that's switched
 * on (`aria-pressed`) is filled and has a line around it in the colour of
 * control borders: the fill alone is about 1.1:1 against the toolbar, the
 * line is 3:1 or more (WCAG 1.4.11).
 */
const toolbarButtonClasses = cn(
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,box-shadow] select-none hover:bg-muted hover:text-foreground disabled:opacity-55 disabled:hover:bg-transparent disabled:hover:text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:shadow-[inset_0_0_0_1px_var(--color-border-strong)] data-[state=open]:bg-muted data-[state=open]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0',
  focusRing,
);

/**
 * The toolbar. Its label says what the buttons are for ("Formatting"), for
 * screen readers.
 *
 * @param props - Component props.
 * @param props.label - What the toolbar is for.
 * @param props.className - Extra classes.
 * @param props.children - Its buttons and separators.
 * @returns The toolbar.
 */
export function Toolbar({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <RadixToolbar.Root
      aria-label={label}
      className={cn('flex flex-wrap items-center gap-1', className)}
    >
      {children}
    </RadixToolbar.Root>
  );
}

/** Props for {@link ToolbarButton}: a button's props, with its name and icon. */
interface ToolbarButtonProps extends Omit<
  ComponentProps<typeof RadixToolbar.Button>,
  'children' | 'aria-label' | 'aria-pressed' | 'title'
> {
  /** What the button does, as its accessible name and its tooltip. */
  label: string;
  /** The icon that stands for it. */
  icon: LucideIcon;
  /**
   * Whether what the button switches is on, for a button that switches
   * something (bold). Leave it out for a button that does something once.
   */
  pressed?: boolean;
}

/**
 * A button of a toolbar: an icon, named by its label. A button that
 * switches something says whether it's on (`aria-pressed`).
 *
 * @param props - Button props.
 * @param props.label - What the button does.
 * @param props.icon - Its icon.
 * @param props.pressed - Whether what it switches is on.
 * @param props.className - Extra classes.
 * @param props.type - Button type.
 * @returns The button.
 */
export function ToolbarButton({
  label,
  icon: Icon,
  pressed = undefined,
  className = '',
  type = 'button',
  ...props
}: ToolbarButtonProps) {
  return (
    <RadixToolbar.Button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn(toolbarButtonClasses, className)}
      {...props}
    >
      <Icon aria-hidden="true" />
    </RadixToolbar.Button>
  );
}

/**
 * A button of a toolbar that shows a value in words, such as a menu's
 * current choice. Its accessible name comes from `aria-label`, which says
 * what the value is of and includes the value.
 *
 * @param props - Button props.
 * @param props.className - Extra classes.
 * @param props.type - Button type.
 * @param props.children - The value shown.
 * @returns The button.
 */
export function ToolbarTextButton({
  className = '',
  type = 'button',
  children = null,
  ...props
}: ComponentProps<typeof RadixToolbar.Button>) {
  return (
    <RadixToolbar.Button
      type={type}
      className={cn(
        toolbarButtonClasses,
        'w-auto max-w-40 gap-1 px-2 text-sm font-medium',
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <ChevronDown aria-hidden="true" />
    </RadixToolbar.Button>
  );
}

/**
 * A line between two groups of buttons.
 *
 * @returns The separator.
 */
export function ToolbarSeparator() {
  return <RadixToolbar.Separator className="mx-1 h-5 w-px bg-border" />;
}
