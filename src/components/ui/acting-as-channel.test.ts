/**
 * @file Tests for the channel the browser's tabs tell each other on that it
 * acts as someone else now: the other tabs hear it, the tab that sends
 * doesn't, nothing else on the channel counts, unsubscribing stops it, each
 * tab has one channel, and it does nothing in a browser without
 * `BroadcastChannel`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stands in for `BroadcastChannel`: a message reaches every other open
 * channel with the same name, at once, never the one that sent it.
 */
class FakeBroadcastChannel extends EventTarget {
  /** The channels opened so far, in every "tab". */
  static opened: FakeBroadcastChannel[] = [];

  /** The channel's name. */
  readonly name: string;

  /**
   * Opens a channel.
   *
   * @param name - The channel's name.
   */
  constructor(name: string) {
    super();
    this.name = name;
    FakeBroadcastChannel.opened.push(this);
  }

  /**
   * Sends a message to the other channels with this name.
   *
   * @param data - The message.
   */
  postMessage(data: unknown): void {
    FakeBroadcastChannel.opened
      .filter((other) => other !== this && other.name === this.name)
      .forEach((other) => other.dispatchEvent(new MessageEvent('message', { data })));
  }
}

/**
 * Loads the module afresh, as a new tab would, so its channel is created
 * again with the `BroadcastChannel` stubbed for the test.
 *
 * @returns The module.
 */
async function freshModule() {
  vi.resetModules();
  return import('./acting-as-channel');
}

beforeEach(() => {
  FakeBroadcastChannel.opened = [];
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tellOtherTabs', () => {
  it('tells the other tabs that the browser acts as someone else now, and nothing more', async () => {
    const { tellOtherTabs, CHANNEL_NAME } = await freshModule();
    const otherTab = new FakeBroadcastChannel(CHANNEL_NAME);
    const heard = vi.fn();
    otherTab.addEventListener('message', (event) => heard((event as MessageEvent).data));

    tellOtherTabs();

    // No name, ID or address.
    expect(heard).toHaveBeenCalledExactlyOnceWith('changed');
  });

  it('does nothing in a browser without BroadcastChannel', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const { tellOtherTabs, onOtherTabChange } = await freshModule();

    expect(() => tellOtherTabs()).not.toThrow();
    const unsubscribe = onOtherTabChange(vi.fn());
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('onOtherTabChange', () => {
  it('calls the listener when another tab says it changed', async () => {
    const { onOtherTabChange, CHANNEL_NAME, CHANGED_MESSAGE } = await freshModule();
    const listener = vi.fn();
    onOtherTabChange(listener);

    new FakeBroadcastChannel(CHANNEL_NAME).postMessage(CHANGED_MESSAGE);

    expect(listener).toHaveBeenCalledOnce();
  });

  it('ignores anything else on the channel', async () => {
    const { onOtherTabChange, CHANNEL_NAME } = await freshModule();
    const listener = vi.fn();
    onOtherTabChange(listener);

    const otherTab = new FakeBroadcastChannel(CHANNEL_NAME);
    otherTab.postMessage('something else');
    otherTab.postMessage({ changed: true });

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not hear its own tab', async () => {
    const { onOtherTabChange, tellOtherTabs } = await freshModule();
    const listener = vi.fn();
    onOtherTabChange(listener);

    tellOtherTabs();

    expect(listener).not.toHaveBeenCalled();
    // One channel per tab, for sending and listening alike.
    expect(FakeBroadcastChannel.opened).toHaveLength(1);
  });

  it('stops once unsubscribed', async () => {
    const { onOtherTabChange, CHANNEL_NAME, CHANGED_MESSAGE } = await freshModule();
    const listener = vi.fn();
    const unsubscribe = onOtherTabChange(listener);

    unsubscribe();
    new FakeBroadcastChannel(CHANNEL_NAME).postMessage(CHANGED_MESSAGE);

    expect(listener).not.toHaveBeenCalled();
  });
});
