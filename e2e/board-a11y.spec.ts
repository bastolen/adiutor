/**
 * @file What the board of requests tells assistive technology: snapshots of
 * its accessibility tree (Playwright's `toMatchAriaSnapshot`) pin down how
 * the row that jumps to a lane, the columns and their halves (their names and
 * counts, a lane that shows fewer cards than it holds, an empty lane), a
 * card, its Move menu, the board's status while a card is moved, the focus
 * after the move and the phone's folding columns are named, so a change a
 * screen reader would notice fails a test. The axe scans and keyboard checks
 * of the board are in `a11y.spec.ts` and `keyboard.spec.ts`.
 *
 * The snapshots are partial: they leave out the page around the board (the
 * header, the filters) and match times with a pattern. Each test stores its
 * own requests in the seeded company and opens the board searched down to a
 * title only it uses, so other specs' requests never change its lanes or
 * their counts. Locators start from `getByRole`, which leaves out pages kept
 * hidden in `<Activity>`. A pass with a real screen reader (VoiceOver) is
 * manual (`docs/design.md`).
 */
import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import { storeOwnRequest } from './support/db';
import { COMPANY_NAME, SUPPORT_STAFF } from './support/fixtures';
import { type StorageState, storageStateFor, toasts, openBoard } from './support/helpers';
import { repeatInOrder } from './support/sequence';
import { expect, test } from './support/test';

/** Sign-in cookies of the staff member the board is read as. */
let staffState: StorageState;

test.beforeAll(async ({ browser }) => {
  staffState = await storageStateFor(browser, SUPPORT_STAFF);
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(staffState.cookies);
});

/** A board of a test's own requests. */
interface OwnBoard {
  /** What their titles have in common, to search the board down to them. */
  search: string;
  /** The open request's title. */
  openTitle: string;
  /** The waiting request's title. */
  waitingTitle: string;
}

/**
 * Stores a board's worth of requests under a title only this test uses: one
 * open, one waiting for the company and six done, one more than Closed's
 * Done half shows. To do, In progress, Waiting for approval and Cancelled
 * stay empty.
 *
 * @returns The board's search and titles.
 */
async function storeBoard(): Promise<OwnBoard> {
  const search = `A board to snapshot ${randomUUID().slice(0, 8)}`;
  const board = { search, openTitle: `${search}, open`, waitingTitle: `${search}, waiting` };
  await storeOwnRequest({ title: board.openTitle });
  await storeOwnRequest({ title: board.waitingTitle, status: 'waiting' });
  // One after another: each request gets the next number.
  await repeatInOrder(6, async (index) => {
    await storeOwnRequest({ title: `${search}, done ${index + 1}`, status: 'done' });
  });
  return board;
}

/**
 * The board's lanes: the row of columns.
 *
 * @param page - The browser page, on the board.
 * @returns The group.
 */
const boardLanes = (page: Page) => page.getByRole('group', { name: 'Lanes' });

test('the row that jumps to a lane names each column with its count', async ({ page }) => {
  // Narrower than the five columns side by side, so the row shows.
  await page.setViewportSize({ width: 1100, height: 900 });
  const { search } = await storeBoard();
  await openBoard(page, search);

  // Each button says its column's heading, never the bare count it shows.
  await expect(page.getByRole('navigation', { name: 'Jump to a lane' })).toMatchAriaSnapshot(`
    - navigation "Jump to a lane":
      - text: Jump to a lane
      - list:
        - /children: equal
        - listitem:
          - button "Open, 1 request"
        - listitem:
          - button "To do, 0 requests"
        - listitem:
          - button "In progress, 0 requests"
        - listitem:
          - button "Waiting, 1 request"
        - listitem:
          - button "Closed, 6 requests"
  `);
});

test('the columns and their halves are groups named by their headings, which say a lane that shows fewer cards or none', async ({
  page,
}) => {
  const { search, openTitle, waitingTitle } = await storeBoard();
  await openBoard(page, search);

  // A column of one lane, and the grouped Waiting and Closed with a half each lane. Done shows
  // its latest five of six, and says so in its list's name; an empty lane says it has none.
  await expect(boardLanes(page)).toMatchAriaSnapshot(`
    - group "Lanes":
      - /children: equal
      - group "Open, 1 request":
        - /children: equal
        - heading "Open, 1 request" [level=2]
        - list:
          - listitem:
            - link "${openTitle}"
      - group "To do, 0 requests":
        - /children: equal
        - heading "To do, 0 requests" [level=2]
        - paragraph: No requests
      - group "In progress, 0 requests":
        - /children: equal
        - heading "In progress, 0 requests" [level=2]
        - paragraph: No requests
      - group "Waiting, 1 request":
        - /children: equal
        - heading "Waiting, 1 request" [level=2]
        - group "Waiting for the company, 1 request":
          - /children: equal
          - heading "Waiting for the company, 1 request" [level=3]
          - list:
            - listitem:
              - link "${waitingTitle}"
        - group "Waiting for approval, 0 requests":
          - /children: equal
          - heading "Waiting for approval, 0 requests" [level=3]
          - paragraph: No requests
      - group "Closed, 6 requests":
        - /children: equal
        - heading "Closed, 6 requests" [level=2]
        - group "Done, 6 requests":
          - /children: equal
          - heading "Done, 6 requests" [level=3]
          - list "Latest 5 of 6":
            - /children: equal
            - listitem
            - listitem
            - listitem
            - listitem
            - listitem
          - link "See all 6 requests in Done"
        - group "Cancelled, 0 requests":
          - /children: equal
          - heading "Cancelled, 0 requests" [level=3]
          - paragraph: No requests
  `);
  // A lane that shows all its cards doesn't name its list: the heading's count says it all.
  await expect(
    page.getByRole('group', { name: 'Open, 1 request' }).getByRole('list'),
  ).toHaveAccessibleName('');
});

test('a card is named by its title and its Move button by its number, and the Move menu lists the lanes it may go to', async ({
  page,
}) => {
  const title = `A card to snapshot ${randomUUID().slice(0, 8)}`;
  const number = await storeOwnRequest({ title });
  await openBoard(page, title);

  // The number and type, the title's link, the company, the priority (the staff's), when it last
  // had activity, and the Move button: nothing else is read, not the dot or the grip.
  const card = page.getByRole('group', { name: 'Open, 1 request' }).getByRole('listitem');
  await expect(card).toMatchAriaSnapshot(`
    - listitem:
      - /children: equal
      - text: AD-${number} Bug
      - link "${title}":
        - /url: /requests/${number}
      - text: ${COMPANY_NAME} Normal priority Last activity
      - time: /.+/
      - button "Move AD-${number}"
  `);

  const move = card.getByRole('button', { name: `Move AD-${number}` });
  await move.click();
  // Named by its button once ("Move AD-n", never "Move Move AD-n"), its label, and the lanes a
  // staff member may move an open request to.
  await expect(page.getByRole('menu')).toMatchAriaSnapshot(`
    - menu "Move AD-${number}":
      - /children: equal
      - text: Move to
      - menuitem "To do"
      - menuitem "In progress"
      - menuitem "Waiting for the company"
      - menuitem "Done"
      - menuitem "Cancelled"
  `);
  await page.keyboard.press('Escape');
  await expect(move).toBeFocused();
});

test('a move is said in the board’s status while it runs, and focus stays on the moved card’s Move button', async ({
  page,
}) => {
  const title = `A card to move and snapshot ${randomUUID().slice(0, 8)}`;
  const number = await storeOwnRequest({ title });
  // The move's request (the server action, a POST to the board) waits until the board has been
  // read in the middle of the move.
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route(
    (url) => url.pathname === '/requests/board',
    async (route) => {
      if (route.request().method() === 'POST') {
        await held;
      }
      await route.continue();
    },
  );
  await openBoard(page, title);
  // The live region is on the page from the start, quiet.
  const status = page.getByRole('main').getByRole('status');
  await expect(status).toHaveText('');

  await page.getByRole('button', { name: `Move AD-${number}` }).click();
  await page.getByRole('menuitem', { name: 'In progress' }).click();

  await expect(status).toMatchAriaSnapshot(`
    - status: Moving AD-${number} to In progress…
  `);
  // The card is in its new lane at once, its Move button busy yet still named, and focused.
  await expect(boardLanes(page)).toMatchAriaSnapshot(`
    - group "Lanes":
      - group "Open, 0 requests":
        - heading "Open, 0 requests" [level=2]
        - paragraph: No requests
      - group "In progress, 1 request":
        - heading "In progress, 1 request" [level=2]
        - list:
          - listitem:
            - link "${title}"
            - button "Move AD-${number}" [disabled]
  `);
  const moved = page
    .getByRole('group', { name: 'In progress, 1 request' })
    .getByRole('button', { name: `Move AD-${number}` });
  await expect(moved).toBeFocused();

  release();
  await expect(toasts(page)).toContainText(`AD-${number} moved to In progress.`);
  // Quiet again, so the outcome is said once (by the toast); focus is still on the card.
  await expect(status).toHaveText('');
  await expect(moved).toBeEnabled();
  await expect(moved).toBeFocused();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('each column’s heading is a button that folds it away, and says whether it’s open', async ({
    page,
  }) => {
    const { search } = await storeBoard();
    await openBoard(page, search);

    await expect(boardLanes(page)).toMatchAriaSnapshot(`
      - group "Lanes":
        - /children: equal
        - group "Open, 1 request":
          - heading "Open, 1 request" [level=2]:
            - button "Open, 1 request" [expanded]
          - list
        - group "To do, 0 requests":
          - heading "To do, 0 requests" [level=2]:
            - button "To do, 0 requests" [expanded]
          - paragraph: No requests
        - group "In progress, 0 requests":
          - heading "In progress, 0 requests" [level=2]:
            - button "In progress, 0 requests" [expanded]
          - paragraph: No requests
        - group "Waiting, 1 request":
          - heading "Waiting, 1 request" [level=2]:
            - button "Waiting, 1 request" [expanded]
          - group "Waiting for the company, 1 request"
          - group "Waiting for approval, 0 requests"
        - group "Closed, 6 requests":
          - heading "Closed, 6 requests" [level=2]:
            - button "Closed, 6 requests" [expanded]
          - group "Done, 6 requests"
          - group "Cancelled, 0 requests"
    `);

    // Folded, a grouped column hides both its halves, and its button says it's closed.
    await page.getByRole('button', { name: 'Closed, 6 requests' }).click();
    await expect(boardLanes(page)).toMatchAriaSnapshot(`
      - group "Lanes":
        - group "Closed, 6 requests":
          - /children: equal
          - heading "Closed, 6 requests" [level=2]:
            - button "Closed, 6 requests" [expanded=false]
    `);
  });
});
