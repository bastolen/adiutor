/**
 * @file Runs before every Vitest test file.
 *
 * Registers Testing Library's DOM matchers (e.g. `toBeInTheDocument()`),
 * unmounts rendered components after each test, and stands in for next-intl
 * so everything renders in English (US) without a request or a provider
 * (`tests/i18n/next-intl-mocks.ts`; `renderInLocale` for other languages).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { DEFAULT_LOCALE } from '@/lib/i18n/locales';

import { nextIntlMock, nextIntlServerMock, testLocale } from './tests/i18n/next-intl-mocks';

vi.mock('next-intl', async (importOriginal) => nextIntlMock(await importOriginal()));
vi.mock('next-intl/server', () => nextIntlServerMock());
/**
 * `next/font` only works inside Next.js's compiler; in tests each font gives
 * its CSS variable's class name and nothing else.
 */
vi.mock('next/font/google', () => {
  /**
   * Stands in for a font loader.
   *
   * @param options - The loader's options.
   * @param options.variable - The CSS variable it defines.
   * @returns The class names Next.js would give.
   */
  const font = ({ variable = '' }: { variable?: string }) => ({
    className: '',
    variable: variable.replace(/^--/, ''),
    style: { fontFamily: '' },
  });
  return { Inter: font, JetBrains_Mono: font };
});
vi.mock('@/lib/i18n/request-locale', () => ({
  /**
   * The request's language in tests.
   *
   * @returns `testLocale.current`.
   */
  default: async () => testLocale.current,
}));

afterEach(() => {
  cleanup();
  testLocale.current = DEFAULT_LOCALE;
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
