/**
 * @file Lets the tabs of this browser tell each other that it acts as
 * someone else now (signing in or out, starting or ending a sign-in as a
 * user), over a `BroadcastChannel`. The session is the browser's cookie, so
 * every tab acts as whoever the last change made it, but a tab that didn't
 * make the change still shows the previous person: its pages kept alive, its
 * layout (the navigation, the banner while signed in as someone). The tab
 * that makes the change tells the others (`loadFresh` with `everyTab`), and
 * they load their page afresh (`ReloadWhenActingAsChanges` in the root
 * layout).
 *
 * The message only says that something changed: never who, nor any ID or
 * address, so nothing about anyone reaches the other tabs. It stays in this
 * browser and isn't logged.
 */
'use client';

/** The channel's name, shared by every tab of Adiutor in this browser. */
export const CHANNEL_NAME = 'adiutor.acting-as';

/** The only message on the channel: the browser acts as someone else now. */
export const CHANGED_MESSAGE = 'changed';

/**
 * This tab's channel, for sending and listening alike: a channel never gets
 * its own messages, so the tab that makes the change doesn't hear itself.
 * Created on first use; `null` where the browser has no `BroadcastChannel`.
 */
let tabChannel: BroadcastChannel | null | undefined;

/**
 * This tab's channel, created on first use.
 *
 * @returns The channel, or `null` where the browser has none.
 */
function channel(): BroadcastChannel | null {
  if (tabChannel === undefined) {
    tabChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;
  }
  return tabChannel;
}

/**
 * Tells the other tabs of this browser that it acts as someone else now, so
 * they load their page afresh. Call it once the change is made (the server
 * answered), so they load as the new person. Does nothing where the browser
 * has no `BroadcastChannel`.
 */
export function tellOtherTabs(): void {
  channel()?.postMessage(CHANGED_MESSAGE);
}

/**
 * Calls `listener` each time another tab of this browser says it acts as
 * someone else now. Anything else on the channel is ignored.
 *
 * @param listener - Called for each such message.
 * @returns The unsubscribe function.
 */
export function onOtherTabChange(listener: () => void): () => void {
  const current = channel();
  if (!current) {
    return () => {};
  }
  /**
   * Passes the message on when it's the one this channel carries.
   *
   * @param event - The message from another tab.
   */
  const handle = (event: MessageEvent) => {
    if (event.data === CHANGED_MESSAGE) {
      listener();
    }
  };
  current.addEventListener('message', handle);
  return () => {
    current.removeEventListener('message', handle);
  };
}
