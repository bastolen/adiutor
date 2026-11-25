/**
 * @file Gives elements a layout in jsdom, which has none.
 */
import { vi } from 'vitest';

/**
 * Gives elements a box, which jsdom doesn't have: `getClientRects()` is always
 * empty there, so code that asks whether an element is shown would see
 * everything as hidden. Undone by `vi.restoreAllMocks()`.
 *
 * @param isHidden - Which elements a test treats as hidden (no box), e.g. a
 *   page `<Activity>` keeps in the background. None by default.
 */
export default function stubLayout(isHidden: (element: Element) => boolean = () => false): void {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function getClientRects(
    this: Element,
  ) {
    return (isHidden(this) ? [] : [{}]) as unknown as DOMRectList;
  });
}
