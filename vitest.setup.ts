/**
 * @file Runs before every Vitest test file.
 *
 * Registers Testing Library's DOM matchers (e.g. `toBeInTheDocument()`) and
 * unmounts rendered components after each test.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * Does nothing; stands in for browser APIs that jsdom lacks.
 */
function noop() {}

/**
 * Reports that no element has pointer capture (jsdom has no pointer capture).
 *
 * @returns Always `false`.
 */
function noPointerCapture() {
  return false;
}

/**
 * jsdom lacks a few browser APIs that Radix UI primitives use (pointer
 * capture, scrolling items into view, observing size changes). Minimal
 * stand-ins let components render and respond in tests. Skipped in files that
 * run in Node (`@vitest-environment node`), which have no DOM.
 */
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= noPointerCapture;
  Element.prototype.setPointerCapture ??= noop;
  Element.prototype.releasePointerCapture ??= noop;
  Element.prototype.scrollIntoView ??= noop;
}
globalThis.ResizeObserver ??= class ResizeObserverStub {
  /** Starts observing (no-op). */
  observe = noop;

  /** Stops observing an element (no-op). */
  unobserve = noop;

  /** Stops observing everything (no-op). */
  disconnect = noop;
};
