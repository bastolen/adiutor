/**
 * @file A harness for unit tests of pages Next.js keeps alive: it hides and
 * shows its content in an `<Activity>`, like navigating away and back does.
 */
import { Activity, type ReactNode, useState } from 'react';

/**
 * Wraps content in an `<Activity>` that a "Leave" / "Return" button hides and
 * shows, like Next.js does with a page when you navigate away and back.
 *
 * @param props - Harness props.
 * @param props.children - The page content.
 * @returns The harness.
 */
export default function Page({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setVisible((value) => !value)}>
        {visible ? 'Leave' : 'Return'}
      </button>
      <Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity>
    </>
  );
}
