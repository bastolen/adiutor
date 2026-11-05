/**
 * @file Sends the user to the step-up page when they start a change that
 * needs a confirmation with their second step from the last 15 minutes,
 * instead of letting them fill in a form or dialog the server will refuse:
 * changing how they sign in (the Security page) and giving someone a staff
 * role or a company's Admin role (`grantNeedsConfirmation`). The server
 * decides (`src/server/auth/auth-guards/`, the services); this only asks
 * first, and also handles the server's refusal when the window ran out while
 * a dialog was open.
 *
 * The step-up page comes back to the page (`returnTo`, with its tables' sort
 * and page) and to the card the control is in (its anchor, `useSectionId`),
 * also when a server action sends the user there: forms inside the provider
 * send that address in a hidden `returnTo` field ({@link ReturnToField}).
 * Every page with such changes renders the provider with its own address;
 * outside a provider nothing asks.
 */
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import Alert from '@/components/ui/alert';
import { useSectionId } from '@/components/ui/anchored-section';
import Button from '@/components/ui/button';
import { withSection } from '@/lib/redirect';
import confirmChangeUrl from '@/lib/sign-in/confirm-url';
import { MFA_VERIFICATION_REQUIRED } from '@/lib/sign-in/sign-in-refusals';

/**
 * The confirmation window, as the page rendered it.
 */
interface RecentConfirmationProps {
  /**
   * Whether changes need a recent confirmation: the account has a second
   * step that can confirm sessions (`Actor.canConfirmSessions`). Without
   * one, there's nothing to protect yet.
   */
  required: boolean;
  /** The end of the window on the server's clock (ms since the epoch), or `null`. */
  confirmedUntil: number | null;
  /** The server's time when the page rendered (ms since the epoch). */
  serverTime: number;
  /**
   * The page to come back to after confirming, with its tables' state
   * (`PageUrl.current()`) but no anchor: each control adds its card's.
   */
  returnTo: string;
}

/** What the forms and cards use. */
interface RecentConfirmationValue {
  /** See {@link RecentConfirmationProps.required}. */
  required: boolean;
  /** Whether the window is still open now (for event handlers). */
  isOpen: () => boolean;
  /** Whether a change must be confirmed first (for rendering; follows the window closing). */
  mustConfirm: boolean;
  /** The page to come back to, without an anchor; `null` outside a provider. */
  returnTo: string | null;
}

/**
 * Outside a provider (on pages without changes that need a confirmation, and
 * in unit tests that render a component on its own), nothing needs
 * confirming and nothing asks: there's no page to come back to. The server
 * still refuses a change without a recent confirmation; the form then shows
 * that refusal's message.
 */
const RecentConfirmationContext = createContext<RecentConfirmationValue>({
  required: false,
  /**
   * Never asked: changes don't need a recent confirmation here.
   *
   * @returns `true`.
   */
  isOpen: () => true,
  mustConfirm: false,
  returnTo: null,
});

/**
 * Provides the confirmation window to a page's forms and cards.
 *
 * @param props - Provider props.
 * @param props.required - Whether changes need a recent confirmation.
 * @param props.confirmedUntil - The end of the window, on the server's clock.
 * @param props.serverTime - The server's time at render.
 * @param props.returnTo - The page to come back to after confirming.
 * @param props.children - The forms and cards.
 * @returns The provider.
 */
export function RecentConfirmationProvider({
  required,
  confirmedUntil,
  serverTime,
  returnTo,
  children,
}: RecentConfirmationProps & { children: ReactNode }) {
  // When this render reached the browser, by its own clock. Kept per server render, so showing the
  // page again from React's <Activity> doesn't restart the window.
  const received = useRef<{ serverTime: number; at: number } | null>(null);
  useEffect(() => {
    if (received.current?.serverTime !== serverTime) {
      received.current = { serverTime, at: Date.now() };
    }
  }, [serverTime]);

  // Whether the window was open when the page rendered, and the render it has closed for since.
  const openAtRender = confirmedUntil !== null && serverTime < confirmedUntil;
  const [closedFor, setClosedFor] = useState<number | null>(null);
  useEffect(() => {
    if (!openAtRender || confirmedUntil === null) {
      return undefined;
    }
    const timer = setTimeout(() => setClosedFor(serverTime), confirmedUntil - serverTime);
    return () => clearTimeout(timer);
  }, [openAtRender, confirmedUntil, serverTime]);
  const openNow = openAtRender && closedFor !== serverTime;

  const value = useMemo<RecentConfirmationValue>(
    () => ({
      required,
      /**
       * Checks the window against the server's clock: its time at render
       * plus how long this render has been in the browser.
       *
       * @returns Whether the window is still open.
       */
      isOpen: () => {
        if (confirmedUntil === null) {
          return false;
        }
        const elapsed = received.current ? Date.now() - received.current.at : 0;
        return serverTime + elapsed < confirmedUntil;
      },
      mustConfirm: required && !openNow,
      returnTo,
    }),
    [required, confirmedUntil, serverTime, openNow, returnTo],
  );
  return <RecentConfirmationContext value={value}>{children}</RecentConfirmationContext>;
}

/**
 * Where the calling control comes back to after confirming: the provider's
 * page with the anchor of the control's card (`useSectionId`), and the
 * step-up page that returns there.
 *
 * @param ownSection - The card's anchor, for a component that renders the
 *   card itself (and so is outside the card's own context).
 * @returns The return address and the step-up page, both `null` outside a provider.
 */
function useReturnAddress(ownSection?: string): {
  returnTo: string | null;
  confirmUrl: string | null;
} {
  const { returnTo } = useContext(RecentConfirmationContext);
  const cardSection = useSectionId();
  const section = ownSection ?? cardSection;
  const here = returnTo === null ? null : withSection(returnTo, section);
  return { returnTo: here, confirmUrl: here === null ? null : confirmChangeUrl(here) };
}

/**
 * Gives the forms and cards what they need to send the user to the step-up
 * page, which comes back to the page and to the card they're in:
 * - `askToConfirm()` when they start a change: it sends them away when the
 *   change needs a confirmation they don't have, and returns whether it did.
 * - `askToConfirmOnRefusal(code)` when the server refused a change: it
 *   sends them away when that was for lack of a recent confirmation.
 * - `mustConfirm`, to show {@link ConfirmFirstNote} instead of a form's
 *   submit button before anything is typed.
 * - `returnTo`, the page and card to come back to (e.g. for a provider's
 *   callback), or `null` outside a provider.
 *
 * Outside a provider neither ever sends anyone away: there's no page to
 * come back to, so a refusal is shown as its message instead.
 *
 * The card is the one the calling component is in. A component that renders
 * the card itself (`<Card id="passkeys">`) is outside it, so it passes the
 * card's anchor.
 *
 * @param section - The anchor of the card the calling component renders, if it does.
 * @returns The checks and the return address.
 */
export function useRecentConfirmation(section?: string) {
  const { required, isOpen, mustConfirm } = useContext(RecentConfirmationContext);
  const { returnTo, confirmUrl } = useReturnAddress(section);
  const router = useRouter();

  /**
   * Sends the user to confirm when a change needs it.
   *
   * @returns Whether they were sent away (so the change shouldn't start).
   */
  const askToConfirm = (): boolean => {
    if (!required || isOpen() || confirmUrl === null) {
      return false;
    }
    router.push(confirmUrl);
    return true;
  };

  /**
   * Sends the user to confirm when a refusal was for lack of a recent
   * confirmation.
   *
   * @param code - The refusal's error code, if any.
   * @returns Whether they were sent away.
   */
  const askToConfirmOnRefusal = (code: string | null | undefined): boolean => {
    if (code !== MFA_VERIFICATION_REQUIRED.code || confirmUrl === null) {
      return false;
    }
    router.push(confirmUrl);
    return true;
  };

  return { askToConfirm, askToConfirmOnRefusal, mustConfirm, returnTo };
}

/**
 * A hidden `returnTo` field with the page and card to come back to, for a
 * form whose server action may send the user to confirm first
 * (`confirmChangeUrlFor`). Nothing outside a provider, where nothing needs
 * confirming.
 *
 * @returns The field, or nothing.
 */
export function ReturnToField() {
  const { returnTo } = useReturnAddress();
  return returnTo === null ? null : <input type="hidden" name="returnTo" value={returnTo} />;
}

/**
 * Shown instead of a form's submit button while the change needs a recent
 * confirmation the user doesn't have: says why, with a link to the step-up
 * page that comes back here, to the card the note is in. Shown as soon as
 * the change is chosen, so nothing typed is lost. Nothing outside a
 * provider, where nothing needs confirming.
 *
 * @param props - Note props.
 * @param props.children - Why, e.g. "Giving this role needs you to confirm it's you first.".
 * @returns The note, or nothing.
 */
export function ConfirmFirstNote({ children }: { children: ReactNode }) {
  const { confirmUrl } = useReturnAddress();
  if (confirmUrl === null) {
    return null;
  }
  return (
    <Alert tone="info">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>{children}</p>
        <Button asChild size="sm">
          <Link href={confirmUrl}>Confirm it&apos;s you</Link>
        </Button>
      </div>
    </Alert>
  );
}
