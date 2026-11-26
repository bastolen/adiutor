/**
 * @file Labelled colour field: a text input for six hex digits, with a
 * swatch next to it that shows the colour and opens the browser's colour
 * picker. The two stay in step. Like `TextField`, forms report errors with
 * `Alert` / `ResultAlert`, not per field.
 *
 * A client component because it holds the typed value and its ids come from
 * `useId` (why: "Ids stay unique across pages kept alive" in docs/design.md).
 */
'use client';

import { useId } from 'react';

import { type HexColour, typedHexColour } from '@/lib/branding';
import cn from '@/lib/cn';

import { fieldControl } from './styles';

/**
 * Props for {@link ColourField}.
 */
interface ColourFieldProps {
  /** Visible label text. */
  label: string;
  /** The swatch's accessible name, e.g. "Pick the accent": it opens the colour picker. */
  pickLabel: string;
  /** Help text below the field, read out with it. */
  description?: string;
  /** The form field's name. */
  name: string;
  /** What's typed, as typed. */
  value: string;
  /** Called with the new text when it's typed or picked. */
  onChange: (value: string) => void;
  /** The colour the swatch shows while nothing (or no colour yet) is typed, e.g. the theme's own. */
  fallback: HexColour;
  /** Whether the field can't be changed. */
  disabled?: boolean;
}

/**
 * A colour field: the text input carries the value the form sends (empty
 * for none), and the swatch before it is a native colour input, invisible
 * over a square of the colour, so it opens the browser's own picker from the
 * keyboard too (Enter or Space) and shows the focus ring on the square. The
 * swatch shows `fallback` while the text isn't a colour.
 */
export default function ColourField({
  label,
  pickLabel,
  description = '',
  name,
  value,
  onChange,
  fallback,
  disabled = false,
}: ColourFieldProps) {
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const shown = typedHexColour(value) ?? fallback;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span className="relative size-10 shrink-0">
          <input
            type="color"
            aria-label={pickLabel}
            value={shown}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-lg border border-border-strong shadow-xs transition-colors peer-hover:border-foreground/60 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-60"
            style={{ backgroundColor: shown }}
          />
        </span>
        <input
          id={inputId}
          name={name}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={fallback}
          maxLength={9}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={disabled}
          aria-describedby={description ? descriptionId : undefined}
          className={cn(fieldControl, 'h-10 max-w-36 font-mono disabled:cursor-not-allowed')}
        />
      </div>
      {description && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
