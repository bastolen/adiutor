/**
 * @file A dialog to look at a file in (a request's attachment): its name as
 * the title, where it is among the files ("3 of 7"), the file itself filling
 * the dialog, and below it Previous and Next, a line about it (its size) and
 * Download. The arrow keys step too, unless what has focus uses them (a
 * video's controls, a text field). Built on `Modal`; presentational: its
 * text comes from its caller.
 */
'use client';

import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { type ReactNode, useEffect, useEffectEvent } from 'react';

import Button from './button';
import Modal from './modal';

/** A step to another file. */
export interface FileStep {
  /** The button's name for screen readers, e.g. "Next file". */
  label: string;
  /** Goes there; `null` at the end of the files, where the button waits. */
  onStep: (() => void) | null;
}

/** Props for {@link FileViewer}. */
interface FileViewerProps {
  /** Whether it's open. */
  open: boolean;
  /** Called when it should close (Escape, the close button, clicking outside). */
  onOpenChange: (open: boolean) => void;
  /** The file's name: the dialog's title. */
  name: string;
  /** Where the file is among the files, e.g. "3 of 7". */
  position: string;
  /** The step to the file before it. */
  previous: FileStep;
  /** The step to the file after it. */
  next: FileStep;
  /** A line about the file, e.g. its size. */
  detail: ReactNode;
  /** Where the file downloads from, and the button's text. */
  download: { href: string; label: string };
  /** Takes the focus when it closes (the file's tile); see `Modal`. */
  finalFocus?: () => boolean | void;
  /** The file itself, which fills the dialog. */
  children: ReactNode;
}

/** Elements whose arrow keys are their own: fields, and a video's controls. */
const OWN_ARROWS = 'input, textarea, select, video, audio, [contenteditable="true"]';

/**
 * The file viewer. Previous and Next stay focusable at the ends of the files
 * (`focusableWhenDisabled`), so stepping with the keyboard never loses focus.
 *
 * @param props - Viewer props.
 * @param props.open - Whether it's open.
 * @param props.onOpenChange - Called when it should close.
 * @param props.name - The file's name.
 * @param props.position - Where the file is among the files.
 * @param props.previous - The step to the file before it.
 * @param props.next - The step to the file after it.
 * @param props.detail - A line about the file.
 * @param props.download - Where the file downloads from, and the button's text.
 * @param props.finalFocus - Takes the focus when it closes.
 * @param props.children - The file itself.
 */
export default function FileViewer({
  open,
  onOpenChange,
  name,
  position,
  previous,
  next,
  detail,
  download,
  finalFocus = undefined,
  children,
}: FileViewerProps) {
  /**
   * Steps with the arrow keys, unless what has focus uses them.
   *
   * @param event - The key pressed.
   */
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (event.target instanceof Element && event.target.closest(OWN_ARROWS)) {
      return;
    }
    const step = { ArrowLeft: previous.onStep, ArrowRight: next.onStep }[event.key];
    if (step) {
      event.preventDefault();
      step();
    }
  });

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={name}
      description={position}
      size="viewer"
      finalFocus={finalFocus}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {children}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {[
              { step: previous, Icon: ChevronLeft },
              { step: next, Icon: ChevronRight },
            ].map(({ step, Icon }) => (
              <Button
                key={step.label}
                variant="secondary"
                size="sm"
                aria-label={step.label}
                disabled={step.onStep === null}
                focusableWhenDisabled
                onClick={() => step.onStep?.()}
                className="px-1.5"
              >
                <Icon aria-hidden="true" />
              </Button>
            ))}
            <span className="text-sm text-muted-foreground">{detail}</span>
          </div>
          <Button asChild size="sm">
            <a href={download.href} download>
              <Download aria-hidden="true" />
              {download.label}
            </a>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
