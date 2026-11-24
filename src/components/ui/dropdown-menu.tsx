/**
 * @file Styled parts for Radix DropdownMenu, so menus look the same
 * everywhere and keep Radix's keyboard behaviour (arrow keys, typeahead,
 * Escape, focus return).
 */
'use client';

import { Check, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { DropdownMenu } from 'radix-ui';
import { type ComponentProps, type KeyboardEvent, type ReactNode, useId } from 'react';

import cn from '@/lib/cn';

import { focusRing, highlightedItem, SCREEN_GUTTER } from './styles';

/** The menu root; controls open state. */
export const MenuRoot = DropdownMenu.Root;

/** The element that opens the menu; use `asChild` with a button. */
export const MenuTrigger = DropdownMenu.Trigger;

/** A group of radio items; `value` and `onValueChange` control the choice. */
export const MenuRadioGroup = DropdownMenu.RadioGroup;

/**
 * Classes shared by menu items. The item the keyboard or pointer is on is
 * filled and outlined ({@link highlightedItem}), so it shows without telling
 * two near-equal fills apart.
 */
const itemClasses = cn(
  'relative flex h-9 items-center gap-2 rounded-md px-2 text-sm text-foreground select-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground',
  highlightedItem,
);

/**
 * The menu panel, rendered in a portal above the page.
 *
 * @returns The panel.
 */
export function MenuContent({
  className = '',
  sideOffset = 6,
  collisionPadding = SCREEN_GUTTER,
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'z-50 min-w-48 rounded-lg border border-border bg-raised p-1 shadow-lg',
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

/**
 * A menu item. Use `asChild` with a link for navigation.
 *
 * @returns The item.
 */
export function MenuItem({ className = '', ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return <DropdownMenu.Item className={cn(itemClasses, className)} {...props} />;
}

/**
 * The check shown at the right of the selected radio item.
 *
 * @returns The indicator.
 */
function RadioIndicator() {
  return (
    <DropdownMenu.ItemIndicator className="absolute right-2 inline-flex">
      <Check aria-hidden="true" className="text-highlight!" />
    </DropdownMenu.ItemIndicator>
  );
}

/**
 * A radio item, showing a check when selected. For a choice that navigates,
 * use {@link MenuRadioLinkItem}.
 *
 * @returns The radio item.
 */
export function MenuRadioItem({
  className = '',
  children = null,
  ...props
}: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem className={cn(itemClasses, 'pr-8', className)} {...props}>
      {children}
      <RadioIndicator />
    </DropdownMenu.RadioItem>
  );
}

/**
 * Props for {@link MenuRadioLinkItem}: a Next.js `Link`'s props (`href`,
 * `scroll`, `onNavigate`, ...) plus the radio item's value.
 */
type MenuRadioLinkItemProps = Omit<ComponentProps<typeof Link>, 'children'> & {
  /** The item's value; it's checked when it's the group's `value`. */
  value: string;
  /** The label. */
  children: ReactNode;
};

/**
 * A radio item that is a link, e.g. a sorting choice whose page shows the
 * rows sorted that way. It looks like {@link MenuRadioItem}, check included,
 * and keeps the menu's keyboard behaviour; choosing it follows the link and
 * closes the menu.
 *
 * @returns The radio item.
 */
export function MenuRadioLinkItem({
  value,
  className = '',
  children,
  ...linkProps
}: MenuRadioLinkItemProps) {
  return (
    <DropdownMenu.RadioItem value={value} asChild className={cn(itemClasses, 'pr-8', className)}>
      {/* The indicator goes inside the link: `asChild` needs a single child. */}
      <Link {...linkProps}>
        {children}
        <RadioIndicator />
      </Link>
    </DropdownMenu.RadioItem>
  );
}

/**
 * Props for {@link MenuCheckboxItem}.
 */
interface MenuCheckboxItemProps extends Omit<
  ComponentProps<typeof DropdownMenu.CheckboxItem>,
  'children' | 'textValue' | 'checked' | 'onCheckedChange' | 'onSelect'
> {
  /** The item's name. */
  label: string;
  /** A line below the name, e.g. what the choice includes; it describes the item. */
  hint?: string;
  /** Whether it's ticked. */
  checked: boolean;
  /**
   * Whether it's ticked because another choice includes it ("ticked along"):
   * it shows ticked, in a muted box, and stays focusable, but it's marked
   * `aria-disabled` and pressing it changes nothing. Its `hint` says why.
   */
  included?: boolean;
  /** Called with the new state when it's pressed; never while it's `included`. */
  onCheckedChange: (checked: boolean) => void;
}

/**
 * A checkbox item: a box on the left, ticked or not, then its name and an
 * optional hint below it. Pressing it (a click, Enter or Space) toggles it
 * and keeps the menu open, so several can be ticked in a row; Escape or Tab
 * closes the menu. The item's name is its label alone, and the hint
 * describes it.
 *
 * @returns The checkbox item.
 */
export function MenuCheckboxItem({
  label,
  hint = undefined,
  checked,
  included = false,
  onCheckedChange,
  className = '',
  ...props
}: MenuCheckboxItemProps) {
  const labelId = useId();
  const hintId = useId();
  const ticked = checked || included;
  return (
    <DropdownMenu.CheckboxItem
      {...props}
      checked={ticked}
      textValue={label}
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
      aria-disabled={included || undefined}
      onCheckedChange={(next) => {
        if (!included) {
          onCheckedChange(next === true);
        }
      }}
      // Keeps the menu open; Radix still calls `onCheckedChange`.
      onSelect={(event) => {
        event.preventDefault();
      }}
      className={cn(itemClasses, 'h-auto min-h-9 items-start py-2', className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border',
          // Ticked along: the same check, in a muted box, since it's ticked by another choice.
          checked && !included ? 'border-primary bg-primary' : 'border-border-strong bg-surface',
        )}
      >
        <DropdownMenu.ItemIndicator className="inline-flex">
          <Check
            className={cn(
              'size-3!',
              checked && !included ? 'text-primary-foreground!' : 'text-muted-foreground!',
            )}
          />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={labelId}>{label}</span>
        {hint && (
          <span id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
    </DropdownMenu.CheckboxItem>
  );
}

/** How far ArrowLeft and ArrowRight move focus inside a {@link MenuRadioRow}. */
const ROW_STEPS: Partial<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 };

/**
 * Moves focus to the previous or next item of a {@link MenuRadioRow} on
 * ArrowLeft or ArrowRight, stopping at the ends like the menu itself.
 *
 * @param event - The key press, from the row's radio group.
 */
function moveWithinRow(event: KeyboardEvent<HTMLDivElement>) {
  const step = ROW_STEPS[event.key];
  if (step === undefined) {
    return;
  }
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      '[role="menuitemradio"]:not([data-disabled])',
    ),
  );
  const index = items.findIndex((item) => item === event.target);
  if (index === -1) {
    return;
  }
  event.preventDefault();
  items[index + step]?.focus();
}

/**
 * Props for {@link MenuRadioRow}.
 */
interface MenuRadioRowProps {
  /** Visible name of the choice, on the left; it also names the group. */
  label: string;
  /** Decorative icon before the label, lined up with the other items' icons. */
  icon: LucideIcon;
  /** Value of the checked item. */
  value: string;
  /** Called with an item's value when it's chosen. */
  onValueChange: (value: string) => void;
  /** The {@link MenuIconRadioItem}s, in order. */
  children: ReactNode;
}

/**
 * A choice shown as one row: its label on the left and the options as a
 * segmented row of icons on the right (styled like `SegmentedNav`). ArrowUp
 * and ArrowDown go through the icons in order like any other items;
 * ArrowLeft and ArrowRight also move between them.
 *
 * @returns The row.
 */
export function MenuRadioRow({
  label,
  icon: Icon,
  value,
  onValueChange,
  children,
}: MenuRadioRowProps) {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-2 py-1 pr-1 pl-2 text-sm text-foreground">
      <span id={labelId} className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        {label}
      </span>
      <DropdownMenu.RadioGroup
        aria-labelledby={labelId}
        value={value}
        onValueChange={onValueChange}
        onKeyDown={moveWithinRow}
        className="flex gap-1 rounded-lg border border-border bg-raised-muted p-1"
      >
        {children}
      </DropdownMenu.RadioGroup>
    </div>
  );
}

/**
 * Props for {@link MenuIconRadioItem}.
 */
interface MenuIconRadioItemProps extends Omit<
  ComponentProps<typeof DropdownMenu.RadioItem>,
  'children' | 'textValue' | 'aria-label' | 'onSelect'
> {
  /** The item's name, for screen readers and typeahead. */
  label: string;
  /** The icon shown in its place. */
  icon: LucideIcon;
}

/**
 * An icon-only radio item for a {@link MenuRadioRow}. The checked one is
 * raised and its icon coloured; choosing one keeps the menu open, so the
 * result can be seen and another option tried.
 *
 * @returns The item.
 */
export function MenuIconRadioItem({
  label,
  icon: Icon,
  className = '',
  ...props
}: MenuIconRadioItemProps) {
  return (
    <DropdownMenu.RadioItem
      {...props}
      aria-label={label}
      textValue={label}
      // Choosing an item keeps the menu open.
      onSelect={(event) => event.preventDefault()}
      className={cn(
        'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors select-none data-disabled:opacity-50 data-[state=checked]:bg-raised data-[state=checked]:text-highlight data-[state=checked]:shadow-xs data-[state=unchecked]:data-highlighted:bg-raised/60 data-[state=unchecked]:data-highlighted:text-foreground',
        focusRing,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
    </DropdownMenu.RadioItem>
  );
}

/**
 * A small heading inside the menu.
 *
 * @returns The label.
 */
export function MenuLabel({ className = '', ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return (
    <DropdownMenu.Label
      className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}

/**
 * A divider between groups of items.
 *
 * @returns The separator.
 */
export function MenuSeparator() {
  return <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />;
}
