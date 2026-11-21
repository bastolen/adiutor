/**
 * @file Runs before every Vitest test file.
 *
 * Registers Testing Library's DOM matchers (e.g. `toBeInTheDocument()`),
 * unmounts rendered components after each test, and stands in for next-intl
 * so everything renders in English (US) and UTC without a request or a provider
 * (`tests/i18n/next-intl-mocks.ts`; `renderInLocale` for other languages and zones),
 * and gives components a router that does nothing.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { DEFAULT_TIME_ZONE } from '@/lib/i18n/time-zones';

import {
  nextIntlMock,
  nextIntlServerMock,
  testLocale,
  testTimeZone,
} from './tests/i18n/next-intl-mocks';

vi.mock('next-intl', async (importOriginal) => nextIntlMock(await importOriginal()));
/**
 * `server-only` refuses to load outside a Server Component; the tests render
 * the components that import it (the Markdown renderer) in a simulated
 * browser. What keeps it out of the real browser is the build, and
 * `src/client-imports.test.ts`.
 */
vi.mock('server-only', () => ({}));
/**
 * The Markdown editor never loads in a unit test, so a Markdown field stays
 * the plain text field it starts as and a test can type into it: the editor
 * needs a real browser to be typed in, which the end-to-end tests give it. A
 * test of the editor itself asks for it (`vi.importActual`), and a per-file
 * `vi.mock` replaces this one.
 */
vi.mock('@/components/ui/markdown/editor', () => {
  throw new Error('The Markdown editor is not loaded in unit tests');
});
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
/**
 * Outside Next.js there is no router: components that call `useRouter` get one
 * whose `push`, `refresh`, `back` and `replace` do nothing. Everything else in
 * `next/navigation` stays real (`redirect`, `notFound`, `usePathname`,
 * `useSearchParams`). A test that checks navigation mocks the module itself;
 * a per-file `vi.mock` replaces this one.
 */
vi.mock('next/navigation', async (importOriginal) => {
  const router = {
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
  };
  return {
    ...(await importOriginal<typeof import('next/navigation')>()),
    /**
     * Stands in for the router hook.
     *
     * @returns The same router every time, with functions that do nothing.
     */
    useRouter: () => router,
  };
});
vi.mock('@/lib/i18n/request-locale', () => ({
  /**
   * The request's language in tests.
   *
   * @returns `testLocale.current`.
   */
  default: async () => testLocale.current,
}));
vi.mock('@/lib/i18n/request-time-zone', () => ({
  /**
   * The request's time zone in tests.
   *
   * @returns `testTimeZone.current`.
   */
  default: async () => testTimeZone.current,
}));

afterEach(() => {
  cleanup();
  testLocale.current = DEFAULT_LOCALE;
  testTimeZone.current = DEFAULT_TIME_ZONE;
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
