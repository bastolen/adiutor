/**
 * @file Accessibility scan used by the end-to-end tests.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** The WCAG 2.2 A and AA rules (axe tags each rule with the version that added it). */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

/** Everything that can be clicked or tapped, by element and by role. */
const TARGETS = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  ...['button', 'tab', 'link', 'menuitem', 'menuitemradio', 'combobox', 'checkbox', 'switch'].map(
    (role) => `[role="${role}"]`,
  ),
].join(', ');

/**
 * Checks that every visible control is at least 24×24px (WCAG 2.5.8), without
 * leaning on the rule's spacing exception, so each is easy to tap on a phone.
 * Links inside a sentence (`display: inline`) don't count, as WCAG exempts
 * them, nor do visually hidden controls and those hidden from assistive
 * technology. A checkbox or radio counts together with its label, since
 * tapping the label ticks it.
 *
 * @param page - The browser page, loaded.
 * @param layer - Selector of the open modal layer to check instead of the whole page.
 */
async function expectTargetsAtLeast24px(page: Page, layer?: string): Promise<void> {
  const small = await page.evaluate(
    ({ scope, targets }) => {
      const root = scope ? document.querySelector(scope) : document.body;
      if (!root) {
        return [`no ${scope}`];
      }
      return [...root.querySelectorAll(targets)]
        .filter((element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          const hidden =
            box.width <= 1 ||
            box.height <= 1 ||
            style.visibility === 'hidden' ||
            element.classList.contains('sr-only') ||
            style.clipPath === 'inset(50%)' ||
            style.clip === 'rect(0px, 0px, 0px, 0px)' ||
            element.closest('[aria-hidden="true"]') !== null;
          const inSentence = element.tagName === 'A' && style.display === 'inline';
          return !hidden && !inSentence;
        })
        .map((element) => {
          const boxes = [element.getBoundingClientRect()];
          if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
            boxes.push(
              ...[...(element.labels ?? [])].map((label) => label.getBoundingClientRect()),
            );
          }
          const width =
            Math.max(...boxes.map((box) => box.right)) - Math.min(...boxes.map((box) => box.left));
          const height =
            Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.top));
          const name = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
          return { width, height, name: `${element.tagName.toLowerCase()} "${name.slice(0, 40)}"` };
        })
        .filter(({ width, height }) => width < 23.5 || height < 23.5)
        .map(({ width, height, name }) => `${name}: ${Math.round(width)}×${Math.round(height)}px`);
    },
    { scope: layer ?? null, targets: TARGETS },
  );
  expect(small).toEqual([]);
}

/**
 * Waits for streamed content to finish loading, then scans the page with axe
 * and fails on any WCAG 2.2 A or AA violation. The failure lists each rule
 * with the elements that broke it. Every control must also be at least
 * 24×24px ({@link expectTargetsAtLeast24px}).
 *
 * While a modal layer (menu, select, dialog) is open, pass its selector to
 * scan just that layer: the page behind it is hidden from assistive
 * technology and unreachable with Tab, which axe can't tell and would report
 * as `aria-hidden-focus`. The page itself is scanned on its own.
 *
 * @param page - The browser page.
 * @param layer - Selector of the open modal layer to scan instead of the whole page.
 */
export default async function expectAccessible(page: Page, layer?: string): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (layer) {
    builder.include(layer);
  }
  const { violations } = await builder.analyze();
  const summary = violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    elements: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(summary).toEqual([]);
  await expectTargetsAtLeast24px(page, layer);
}
