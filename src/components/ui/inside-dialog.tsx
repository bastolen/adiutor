/**
 * @file Tells what a dialog shows that it's inside one. An error an open
 * dialog shows inline raises no toast: a toast is a layer of its own, above
 * the dialog, and Radix gives Escape to the newest layer only, so the first
 * Escape would dismiss the toast and leave the dialog open. `Modal` marks its
 * content; `ResultAlert` and `Alert`'s `alsoToast` ask.
 */
'use client';

import { createContext, type ReactNode, useContext } from 'react';

/** Whether the components below render inside an open dialog. */
const InsideDialogContext = createContext(false);

/**
 * Props for {@link InsideDialog}.
 */
interface InsideDialogProps {
  /** The dialog's content. */
  children: ReactNode;
}

/**
 * Marks a dialog's content as being inside a dialog, for
 * {@link useInsideDialog}.
 */
export function InsideDialog({ children }: InsideDialogProps) {
  return <InsideDialogContext value>{children}</InsideDialogContext>;
}

/**
 * Whether the component renders inside a dialog ({@link InsideDialog}), where
 * an error shown inline raises no toast.
 *
 * @returns Whether it's inside a dialog.
 */
export function useInsideDialog(): boolean {
  return useContext(InsideDialogContext);
}
