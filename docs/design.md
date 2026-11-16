# Design, accessibility and dark mode

How the interface is built and kept accessible, how light and dark mode work, and the brand
assets. Back to the [documentation](README.md).

## Design and accessibility

The interface aims to feel calm and trustworthy, and to meet
[WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA everywhere, in light and dark mode, with full
keyboard support.

- **Components:** build UI from `src/components/ui/` (`Button`, `TextField`, `SelectField`,
  `Card`, `PageHeader`, `AuthHeading`, `AuthDivider`, `Table`, `Badge`, `Alert` (optionally
  dismissible), `Banner` (a notice with an icon, title and actions, e.g. on the dashboard),
  `ResultAlert`, `ConfirmDialog`, `DropdownMenu`, `Sheet` (a slide-over panel), `EmptyState`,
  `IconRow`, `IconTile` (a decorative icon on a tinted square), `DescriptionList` (labels and
  values), `Skeleton`, `Pagination`, `SortMenu`, `FilterMenu`, ...). Menus, selects, dialogs and
  sheets are
  built on [Radix UI](https://www.radix-ui.com), and only `src/components/ui/` imports it. Radix
  follows the WAI-ARIA patterns: arrow keys, typeahead, Escape to close, focus kept inside
  dialogs and returned to the button that opened them. In a menu, `MenuRadioRow` with
  `MenuIconRadioItem`s shows a choice as a segmented row of icons (like the theme in the account
  menu); ArrowLeft and ArrowRight also move within it. `MenuRadioLinkItem` is a radio item that is
  a link (the sorts in `SortMenu`, the choices in `FilterMenu`). A `Badge`'s tone says what kind of status it is: `success` for
  active or verified, `warning` for something that needs attention (expired, not verified),
  `danger` for deactivated or revoked, and `accent` (outlined in the link colour) for what's about
  the viewer, like "You" on their own row. A status keeps one tone on every screen, which
  `src/components/ui/badge-tones.test.ts` checks (it reads a badge whose label is one message,
  `{t('deactivated')}`, as its English text). Icons come from
  [Lucide](https://lucide.dev) and are hidden from screen readers; icon-only buttons have an
  `aria-label`. Join classes with `cn()` (`src/lib/cn.ts`).
- **Tables** of records sort and paginate (`src/lib/tables/table-state.ts`, with their links built
  in `src/lib/tables/page-url.ts` and each table defined in `src/lib/tables/tables.ts`):
  - **Sorting:** every table sorts from its Sort menu (`SortMenu`) in the card header or next to
    the filters, at every width. The button says how the table is sorted ("Name, A to Z"; just
    "Sort" on phones) and lists each sort both ways, A to Z or newest first at the top.
    Column headers are plain text: the column the table is sorted by has `aria-sort`
    (`TableLinks.ariaSort`) for screen readers, and the caption says how it's sorted. People and
    companies are sorted by name until another order is chosen; invitations, invite links and
    devices newest first. People tables (users, staff, members) sort by name, email, last
    active and joined.
  - **Your own row:** in people tables your row has a "You" badge after your name (`YouBadge` in
    `src/app/(app)/_people/you-badge.tsx`, in the `accent` tone) and a bar in the accent colour
    on its left edge (`ownRowCell` in `src/components/ui/table.tsx`), so you can spot yourself
    while scrolling. The bar is decorative: the badge says it in words. The staff and members
    tables build their first cell with `PersonCell` (`src/app/(app)/_people/person-cell.tsx`).
  - **Pages:** 25, 50 or 100 rows per page, chosen in the table's footer (`Pagination`: "Showing
    26–50 of 132", Previous, the page numbers and Next). The footer only shows with more than 10
    rows.
  - **In the address:** each table keeps its state in the query string with its own prefix
    (`sort`, `dir`, `page` and `size` for a page's main table; `inv-…`, `links-…`, `companies-…`
    and `devices-…` for the others), leaving defaults out, so a sorted page can be bookmarked and
    Back restores it. Links are built only from known parameters, so one-off messages (such as
    "GitHub is now connected") don't come back. They don't scroll the page (`scroll={false}`), so
    the control you used stays under the pointer and keeps keyboard focus; the old rows stay on
    screen until the new ones arrive, and the caption says how the table is sorted and which page
    it shows. Unknown values fall back to the defaults, and a page past the end shows the last one.
    Search (`SearchForm`, on `next/form`) and filter links (`SegmentedNav`) work the same way:
    they load the list within the app without scrolling, keep focus and the pages kept alive, and
    show a busy state (a spinner in the Search button, or in the followed filter link) until the
    list arrives; without JavaScript, search is a plain GET. A list with more to filter by than
    fits in a row of links has a `FilterMenu` per filter next to its Sort menu (the company, type
    and priority of requests): a button that names the filter and, once one is chosen, the choice
    ("Type: Bug"), with the choices as links in a menu, "All" first. It keeps focus like the Sort
    menu does. It needs JavaScript, unlike the search and the status links.
  - **Widths:** no table scrolls sideways. The content area stops growing at 1280px (`xl`,
    `max-w-5xl` in the app layout), so a table gets no more columns past that. Columns that don't
    fit move under the name instead:
    - **Activity:** people tables show when someone was last active and when they joined in
      one Activity column from 1280px, and under the name below that
      (`src/app/(app)/_people/activity.tsx`).
    - **Users:** the MFA status and companies always show under the name, the address from
      768px in its own column.
    - **Staff and members:** the address always shows under the name (unless it is the name),
      and the role from 768px in its own column.
    - **Companies:** the URL name always shows under the name, and the status and when it was
      added from 768px in their own columns, so on a phone the name keeps the room.
    - **Long values:** names, addresses and company names wrap (`wrap-anywhere`) rather than
      widening the table.
    - **Check:** `e2e/tables.spec.ts` checks every table at 640, 768, 1024, 1280, 1536 and
      1920px, with a seeded staff member who has no name and a long address.
  - **List services** take the table's state and return one page with the total
    (`Paged<T>`); each sort ends with the row's ID, so pages don't overlap and reversing is exact.
- **Cards** have 24px padding on every side. Settings with actions use full-width rows (what it does
  on the left, the button on the right). Destructive settings that can't be undone, like deleting or
  deactivating an account, get their own `Card` with `tone="danger"`.
- **Messages don't outlive the page:** with Cache Components, Next.js keeps the last few pages alive
  (hidden with React's `<Activity>`) instead of unmounting them, so their state survives navigation.
  Typed input should, but a "Saved" or error message, or an open dialog, shouldn't still be there when
  you come back. Forms use `useTransientActionState` instead of `useActionState`, and status
  messages and dialog open state use `useTransientState` instead of `useState`
  (`src/components/ui/use-transient-state.ts`); both reset when the page is hidden.
- **A new person means a new page load:** what's kept alive belongs to whoever was signed in, and
  React keeps a field's value even when a page comes back for someone else. So every change of who
  the browser acts as (signing in or out, starting or ending a sign-in as a user, also when it ends
  by itself) ends with a full page load (`loadFresh` in `src/components/ui/load-fresh.ts`), never `router.push` or
  `router.replace`, as does a change of language. The browser's other tabs load their page afresh
  too (`everyTab`, heard by `ReloadWhenActingAsChanges` in the root layout), except after an end
  by itself, which each tab finds on its own. A change that ends in a redirect (a provider or an
  email link, or a server action that redirects) leaves the next page a cookie instead
  (`ACTING_AS_CHANGED_COOKIE`, `markActingAsChanged`), which does the same. See
  [Signing out](authentication.md#signing-out).
- **A refused submit keeps the input:** React 19 resets a `<form action>` after every submit,
  whatever the result. Forms pass both the action and the hook's `onSubmit`
  (`<form action={formAction} onSubmit={onSubmit}>`), which runs the action itself and clears the
  form only after a successful result (`resetOnSuccess`, on by default). Forms that edit a saved
  setting (the staff page's default language) pass `resetOnSuccess: false`: there's nothing to
  clear, and a cleared `SelectField` goes back to the value it showed when the page loaded (Radix
  Select restores that on a form reset), not the one just saved. A bulk invite that sent some
  invitations keeps just the addresses that weren't sent. The sign-in pages are the exception to keeping typed input: the sign-in form and the code step keep their
  fields, busy state and "Trust this device" in `useTransientState` too, because they come back
  when someone goes back to them (from the code step to the sign-in page, say), and whoever does
  mustn't find the last user's details or a button still busy. They also reset a busy button when the browser restores them from its
  back/forward cache (`pageshow`).
- **Illustrations** (like the example request on the sign-in pages) are `inert`, and use
  `<Button decorative>` for buttons that only look like buttons: no hover, focus or press effects.
- **Button labels** stay on one line when they fit. A button is never wider than its container
  (`max-w-full`): a longer label wraps onto a second line and makes the button taller (it has a
  minimum height, not a fixed one), and a card's actions wrap onto more lines too. Buttons in table
  cells stay on one line (`Td`), since a table would squeeze a button that may wrap. Longer
  languages and a "Last used" badge then never run out of a card or make a narrow screen scroll
  sideways.
- **Menus and select lists** keep at least the page's 16px side gutter from the screen's edges
  when they would otherwise run off it (`SCREEN_GUTTER` in `src/components/ui/styles.ts`, Radix's
  `collisionPadding`).
- **Colours:** semantic tokens in `src/styles/theme.css`, each checked for contrast (at least 4.5:1
  for text, 3:1 for input borders) in both modes:

  | Token                                            | Use                                            |
  | ------------------------------------------------ | ---------------------------------------------- |
  | `background`, `surface`, `muted`                 | Page, cards and panels, subtle fills           |
  | `raised`, `raised-muted`                         | Dialogs, menus, selects, toasts; fills in them |
  | `overlay`                                        | The dim behind dialogs                         |
  | `border`, `border-strong`                        | Dividers; borders of inputs and controls       |
  | `foreground`, `muted-foreground`                 | Body text; secondary text                      |
  | `primary`, `primary-hover`, `primary-foreground` | Main actions and the text on them              |
  | `highlight`, `ring`                              | Links and highlights; focus rings              |
  | `danger`, `success`, `warning` (+ `-soft` fills) | Errors and destructive actions; statuses       |

  Layers that float above the page use `raised`, a step lighter than `surface` in dark mode so they
  stand apart (white in light mode), and fills inside them `raised-muted`, not `muted`, which would
  vanish on them. `src/styles/theme.test.ts` checks their contrast in both modes.

  Never make text lighter with opacity (`text-foreground/60`): contrast can't be guaranteed that
  way. Brand orange is too light for small text on white, so errors use the darker `danger`.

- **Font:** Inter for text and JetBrains Mono for codes, URL names and references, which Adiutor
  ships (`src/lib/fonts.ts`, served from its own domain), so text looks and measures the same on
  every device and in CI; line height = font size + 8px. Emails use the device's own font, since
  email clients often block web fonts. See [decision 0016](decisions/0016-ship-inter-and-jetbrains-mono.md).
- **Layout:** signed-in pages have a sidebar that becomes a menu button and slide-over panel
  (`Sheet`) on small screens, which opens with focus on the link to the current page; signed-out
  pages use `AuthLayout`, with a decorative brand panel on wide screens.
  The 404 page uses `CenteredLayout`: the logo top left (where the sidebar has it) and the message
  centered, with "Go to your dashboard" ("Go to sign in" for someone who isn't signed in) and a
  "Go back" button (`BackButton`, shown only when the tab has a previous page).
  Every page has a "Skip to main content" link, one `h1` and `header`/`nav`/`main` landmarks.
  The skip link moves focus to `<main id="main">` from script (`focusMainContent` in
  `src/components/ui/focus-fallback.ts`). The main content is focusable only then, until focus
  leaves it: with a lasting `tabIndex={-1}`, a click in the content on something that can't take
  focus, like a disabled field, would hand focus to it, and Chrome then draws a blinking text
  cursor in the field.
- **Errors:** when a page or server action fails unexpectedly, an error page takes the page's
  place, built like the 404 pages: "Something went wrong", "This page couldn't load. Try again, or
  go to your dashboard.", **Try again** (busy while the page loads again), **Go to your dashboard**
  and the reference box (`ErrorReference`: the reference, its time and **Copy reference**, shared
  with the sign-in error page). Focus moves to the heading, so screen readers announce it. Inside
  the signed-in app (`src/app/(app)/error.tsx`) it's a `Card` with an `EmptyState`, like the app's
  404 page, and the navigation, account menu and theme stay. Elsewhere, and when the app's layout
  itself fails (`src/app/error.tsx`), it uses `CenteredLayout` and adds "Go back". When even the
  root layout fails, `src/app/global-error.tsx` shows the same page in a document of its own and
  applies the saved theme itself, since the inline theme script isn't there.
  The reference appears once it's known: worked out from Next's digest for errors from the server,
  or returned by the report the page sends for errors in the browser; when that report fails, the
  page simply shows no reference.
- **Interaction:** every control has hover, pressed, focus-visible (a 2px ring), disabled and busy
  states. Clickable things show a pointer cursor, disabled ones a not-allowed cursor and busy ones
  a wait cursor (base rules in `src/app/globals.css`). While its action runs a button is busy
  (`Button`'s `loading`: a spinner, `aria-busy`, `aria-disabled` and the wait cursor) and ignores
  presses, so nothing is submitted twice. It's busy rather than disabled, because a disabled
  button loses keyboard focus the moment the action starts and doesn't get it back, which would
  leave keyboard users at the top of the page after every form they send. Where several buttons
  each start an action and only one may run at a time (the sign-in page's passkey, provider and
  password buttons, or a request's two reply buttons), only the pressed one is busy and the others are disabled
  (`whileRunning(running, action)` from `src/components/ui/button.tsx`): one flag for all of them
  would disable the pressed button too, and show a spinner on buttons nobody pressed. A button
  that its own use makes wait, like "Send a new code" counting down after a code was sent, stays
  focusable while it can't be pressed (`Button`'s `focusableWhenDisabled`: `aria-disabled`, the
  not-allowed cursor, presses ignored, no spinner). The same goes for a button its own action
  turns off once the page refreshes, such as "Sign out other devices" with none left, "Reset
  two-step verification" with nothing left to reset or "Add to company" for the last company:
  `RowAction` and `ActionDialog` take `focusableWhenDisabled` and hand it on (while signed in as a
  user they're disabled all the same). Destructive actions ask
  for confirmation in a `ConfirmDialog`. A role select only saves when an option is picked (Enter or click), never while
  arrowing through the list; on the user's own row it asks first (`confirmChange`, with the
  question for each role worded by the page, e.g. "Step down to Manager?"), and cancelling puts it
  back and returns focus to it. While it saves it's busy (`SelectField`'s `busy`:
  `aria-busy`, the wait cursor, and it doesn't open) rather than disabled, and it stays mounted, so
  keyboard focus stays on it before and after the result. `ConfirmDialog` usually opens from its
  trigger; without one the caller opens it (`open`, `onOpenChange`, with the open state in
  `useTransientState`) and returns focus itself (`onCloseAutoFocus`). When an action removes the
  control that had focus (a removed row, "Make staff" becoming "Remove staff access", turning
  two-step verification off, a dismissed notice), focus moves to the heading of its card (card
  headings take focus from script, `tabIndex={-1}`) or, outside a card, to the main content
  (`restoreFocusIfLost` in `src/components/ui/focus-fallback.ts`, which focuses it with
  `focusMainContent`), never to `<body>`.
  - **Signed in as someone.** While a staff member is signed in as a user, the controls that change
    something render disabled, and the banner says changes are turned off (see
    [Signing in as a user](authentication.md#signing-in-as-a-user)). The banner mounts
    `SignedInAsMarker`, and controls read `useSignedInAs` (`src/components/ui/signed-in-as.tsx`).
    `RowAction`, `ActionDialog` and `RoleSelect` do it themselves; pass `allowedWhileSignedInAs`
    for the user's own work. Forms that change something pass the hook's value as `disabled` to
    each field, select and submit button, so the attribute is on the control itself (Radix selects
    read their own `disabled`). They also wrap their contents in `ChangesFieldset`, a disabled
    fieldset then, which turns off anything a form missed, without a box or a group of its own.
    Reads (search, filters, sorting, paging) stay as they are. The server refuses changes
    either way, so a control that misses this still changes nothing.
  - **Card anchors.** A `Card` whose controls can send the user away and back (a confirmation, a
    provider, an emailed link) gets an `id`, a section ID like `invitations` (see
    [Coming back to where you were](authentication.md#coming-back-to-where-you-were)). The
    return addresses its controls send end in it. A table that isn't a page's main table names its
    card in its definition (`TableDefinition.section`, `table.section`), and its sort and page
    links end in that anchor too, which only matters in a new tab, since in the app they don't
    scroll.
  - **Landing.** When the user comes back to the page with that anchor in the URL, the card
    (`AnchoredSection` in `src/components/ui/anchored-section.tsx`) lands them on it. That is on
    mount or when `<Activity>` shows the page again, one frame later, because Next.js scrolls to
    an anchor only when the card is already on the page and never moves focus.
    - With focus nowhere (on `<body>`, or on a control of the page left behind), it scrolls the
      card into view and focuses its heading.
    - With focus already inside the card (a result `Alert` with `focusOnShow`), it only scrolls.
    - Otherwise it leaves the page alone.
  - **Sticky header.** Cards scroll to 5rem from the top below `lg`, clear of the sticky header,
    and 2.5rem from `lg` up (`scroll-mt-20 lg:scroll-mt-10`).

  Pages with section tabs (a company's Requests, Members and Settings; the account's Profile and
  Security) get their header and tabs from a layout (`companies/[companyId]/layout.tsx`,
  `account/layout.tsx`), which stays mounted while the page under it changes: the tab you chose
  keeps focus and the header doesn't reload. `SegmentTabNav` marks the current tab from the URL
  (`useSelectedLayoutSegment`), and each page still checks its own permission.

- **Results:** in the signed-in app every success is a toast and every error is shown inline and as
  a toast (`src/components/ui/toast.tsx`, on Radix UI's Toast; the app layout mounts its `Toaster`
  next to the content, not around it). The one exception is an error an open dialog shows, which
  stays inline: a toast is a layer of its own above the dialog, and Radix gives Escape to the
  newest layer, so the first Escape would dismiss the toast and leave the dialog open. `Modal`
  marks its content (`InsideDialog` in `src/components/ui/inside-dialog.tsx`), and `ResultAlert`
  and `Alert`'s `alsoToast` raise no toast for an error there, so one Escape always closes a
  dialog. Toasts sit at the bottom right
  (bottom centre on phones) in a region named "Notifications (F8)" that F8 jumps to, named in the
  reader's language (`common.notifications`; Radix's own names are English). Successes stay
  6 seconds and errors 10, both pausing while hovered or focused, and each can be dismissed or
  swiped away. A success toast is announced, after the word "Notification"; an error toast's text
  isn't announced again, because the inline error already is (or takes focus), so it announces
  "Notification" and the one word "Error" in its place. `RowAction`, `ActionDialog` and `RoleSelect` toast
  as soon as their action returns, so the toast outlasts a row the refresh removes (`RowAction`'s
  `doneMessage` names the row, e.g. "Invitation to jane@adiutor.dev revoked."); `ResultAlert`
  toasts a form's result, `Alert`'s `alsoToast` an error a component shows itself, and
  `ToastOnArrival` a confirmation that comes with a redirect ("User deleted."). An action that
  ends with a full page load (`loadFresh`) leaves its toast for the next page with
  `showToastAfterLoad`, which the `Toaster` there shows once ("You're back in your own account.");
  it's kept in the tab's `sessionStorage` and counts for 30 seconds. Results to act on
  stay inline: a new company's "Open the company", a new invite link to copy. The signed-out
  pages (sign in, the code step, password reset, invitations, `/setup`) show their results inline
  only.
- **Tap targets:** every control is at least 24×24px (WCAG 2.5.8) without leaning on the rule's
  spacing exception, so each is easy to tap on a phone. Text links on their own line reach 2px above
  and below the text (`TextLink`, cancelled by a negative margin, so nothing moves), and a checkbox
  counts with its label (`CheckboxField`). Links inside a sentence are exempt, as in WCAG.
- **Forms:** labels are always visible and help text is linked with `aria-describedby`. Fields
  don't show errors themselves: a failed submit shows an `Alert` (`ResultAlert`) and moves focus
  to it, and in the signed-in app a toast too (not in a dialog, see Results). Each result gets an
  alert of its own (`ResultAlert` keys it on the result), so the same error a second time is
  announced and takes focus again instead of leaving the page as it was.
  Inline confirmations use `role="status"` and errors `role="alert"`, so screen readers announce
  them. Field text is 16px on every device (`fieldControl` in `src/components/ui/styles.ts`),
  never smaller, because iOS Safari zooms the page in when a field with smaller text gets focus.
  Don't work around that with `maximum-scale` in the viewport: it also blocks pinch-zoom.
- **Page titles:** "Page · Adiutor", most specific part first. Next's route announcer reads the
  title after each client-side navigation (only when it changed), so pages that differ get
  different titles: a company's pages add the company ("Members · Adiutor Tests · Adiutor"), from
  the company layout's `generateMetadata`, after the same access check as the pages. Next doesn't
  apply a layout's title template to the page in the layout's own route segment, so the company's
  first page names the company itself ("Requests · Adiutor Tests · Adiutor",
  `companyPermissionMetadata`). Titles never name a person or carry what someone wrote (a user's
  page is "User · Adiutor", a request's "Request AD-142 · Adiutor"): they end up in the browser
  history, which holds no personal data. Someone who may not see a page
  (a missing permission, a company they're not in, a user that doesn't exist) gets the 404 page,
  and its title too: "Not found · Adiutor" (`notFoundMetadata` in `src/lib/not-found-metadata.ts`).
  Pages and layouts that require a permission therefore export their `generateMetadata` from
  `src/server/page-metadata.ts`, with the same check as the page: `globalPermissionMetadata`
  (with `requireGlobalPermission`, plus an `exists` check for a page about one record, like a
  user's) or `companyPermissionMetadata` (with `requireCompanyAccess` and a permission). Both take
  the title as a message key (`'admin.users.title'`), translated in the request's language; the
  company layout's template ("%s · {company} · Adiutor") is the message `companies.titleTemplate`.
  A page that decides with a check of its own (a request's, which everyone who may see the request
  may open) uses `checkedPageMetadata` with that check.
  `src/app/permission-titles.test.ts` fails when one of them has a static title instead.
- **Page headers:** `PageHeader` keeps its actions to the right of the title while the title has
  room to read (10rem), and moves them below it on narrower screens, rather than squeezing the
  title into a column.
- **Motion:** short transitions only, and none at all when the device asks for reduced motion.

Two end-to-end specs keep this true: `e2e/a11y.spec.ts` scans every page (and open menus, selects,
dialogs and the mobile menu) with [axe](https://github.com/dequelabs/axe-core) against the WCAG 2.2
A and AA rules in light and dark mode, and that every control is at least 24×24px, and checks that no page scrolls sideways on a 320px-wide
screen, in every language (with the sign-in page's widest buttons, "Last used" badge included) and
while signed-in pages still show their loading placeholders, and that no field's text is under 16px.
The pages are scanned as the staff Admin, and the ones that look different to someone at a company
(the dashboard, the requests) also as a Client and as a Watcher.
`e2e/keyboard.spec.ts` checks the skip link, menus, selects, dialogs, the mobile menu, the request
controls and cursors using only the keyboard, that a button keeps focus while its form saves, and
that an error in a dialog takes focus each time it comes and leaves the dialog one Escape away.

## Dark mode

The site supports light and dark mode. Visitors choose **System** (the default, following their
device), **Light** or **Dark**:

- **Signed out** (`AuthLayout`, and `CenteredLayout` for the 404, sign-in error and error pages): one
  button for the theme and the language (`PreferencesMenu` in
  `src/components/layout/preferences-menu.tsx`), on every page without the account menu: floating
  in the bottom-right corner from tablet width, and at the end of the page below that, where a
  fixed button would cover the page's last links on a small phone. It shows
  two icons split by a thin line, the current theme's and the language's flag, and is named in
  full for screen readers ("Theme and language: System, English (US)"). Its Radix menu has the
  theme as the same row of three icons as the account menu, then the language: Default first (a
  globe where the flags go; it follows Adiutor's default language), then the languages, each with
  its flag, named in itself and marked with its `lang` (see
  [Languages](i18n.md#how-the-language-is-chosen)).
- **Signed in:** a row of three icons in the account menu (`src/app/(app)/account-menu.tsx`).

Choosing a theme keeps the menu open, so the result shows at once.

Both use the same hook (`useThemePreference`) and the same row (`ThemeMenuRow` in
`src/components/theme/theme-menu-row.tsx`, with its labels in `common.theme` and its icons in
`src/components/theme/theme-options.ts`: half sun, half moon for **System**, so it reads as a
theme; a sun; a moon), so a choice made before signing in carries over. The row's "Theme" label
has a palette icon, apart from the options.

- **Stored choice:** saved in `localStorage` (`adiutor-theme`) and kept in sync across tabs. With
  System, the page follows device changes live.
- **No flicker:** a small inline script in `<head>` (`themeScript` in `src/lib/theme.ts`) sets
  `data-theme="light"` or `"dark"` on `<html>` before the page paints, so the first frame already has
  the right colours. Without JavaScript, CSS follows the system setting.
- **Colours:** each semantic colour is defined once in `src/styles/theme.css` as
  `light-dark(<light>, <dark>)`, so both values sit side by side when you check contrast.
- **Styling:** use the semantic colours (see [Design and accessibility](#design-and-accessibility))
  such as `bg-surface text-foreground` instead of fixed colours like `bg-white` or `text-ink`; they
  switch with the mode. For anything else, use the `dark:` variant (e.g. `dark:hidden`).
- **Logo:** use the `Logo` component (`src/components/brand/logo.tsx`), which shows `logo.svg` in
  light mode and `logo-on-dark.svg` in dark mode.

## Brand

Logos and icons live in `public/brand/`, cropped to their content with no background:

| File                               | Use on                              |
| ---------------------------------- | ----------------------------------- |
| `logo.svg`, `icon.svg`             | Light backgrounds                   |
| `logo-on-dark.svg`                 | Dark backgrounds (ink)              |
| `logo-white.svg`, `icon-white.svg` | The brand gradient or accent colour |

`src/styles/theme.css` is the Tailwind theme: the brand colours (`brand-teal`, `brand-green`,
`brand-orange`, `ink`), the fonts (Inter and JetBrains Mono, then the system fonts as fallbacks),
text sizes with line height = font size + 8px, short entrance animations, and the semantic colours
described under [Design and accessibility](#design-and-accessibility). Use the brand colours for
brand moments only; UI uses the semantic colours.

The brand assets aren't covered by the code's MIT License; see [License](../README.md#license).
