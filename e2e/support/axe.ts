/**
 * @file Accessibility scan used by the end-to-end tests.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** The WCAG 2.2 A and AA rules (axe tags each rule with the version that added it). */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

/**
 * Waits for streamed content to finish loading, then scans the page with axe
 * and fails on any WCAG 2.2 A or AA violation. The failure lists each rule
 * with the elements that broke it.
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
}
