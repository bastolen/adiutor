# Design, accessibility and dark mode

How the interface is built and kept accessible, how light and dark mode work, and the brand
assets. Back to the [documentation](README.md).

## Design and accessibility

The interface aims to feel calm and trustworthy, and to meet
[WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA everywhere, in light and dark mode, with full
keyboard support.

### Components

- **Components:** build UI from `src/components/ui/` (`Button`, `TextField`, `SelectField`,
  `Card`, `PageHeader`, `AuthHeading`, `AuthDivider`, `Table`, `Badge`, `Alert` (optionally
  dismissible), `Banner` (a notice with an icon, title and actions, e.g. on the dashboard),
  `ResultAlert`, `ConfirmDialog`, `DropdownMenu`, `Sheet` (a slide-over panel), `Popover` (a small
  panel to read that opens from a button, such as the names behind a row of avatars), `EmptyState`,
  `IconRow`, `IconTile` (a decorative icon on a tinted square), `RowLink` (the name in a table row
  or list item, stretched so the whole row is one click target), `DescriptionList` (labels and
  values), `ColourField` (a colour in hex, with a swatch that opens the browser's colour picker),
  `Skeleton`, `Pagination` (with `PageSizeLinks`, its choice of sizes, on its own for a
  view without pages), `SortMenu`, `FilterMenu`, ...). Menus, selects, dialogs and
  sheets are
  built on [Radix UI](https://www.radix-ui.com), and only `src/components/ui/` imports it. Radix
  follows the WAI-ARIA patterns: arrow keys, typeahead, Escape to close, focus kept inside
  dialogs and returned to the button that opened them. `Modal` is as wide as a short form, or
  `large` (most of the window, the whole screen on a phone, its content filling the height) for
  something to write with room; where the focus shouldn't go to its first control or back to
  its opener, it's told what gets it instead (`initialFocus`, `finalFocus`: the Markdown editor's
  large view gives it to the text both times). In a menu, `MenuRadioRow` with
  `MenuIconRadioItem`s shows a choice as a segmented row of icons (like the theme in the account
  menu); ArrowLeft and ArrowRight also move within it. `MenuRadioLinkItem` is a radio item that is
  a link (the sorts in `SortMenu`, the choices in `FilterMenu`; both are built on `LinkRadioMenu`, which holds the open state, the busy button and the navigation). A `Badge`'s tone says what kind of status it is: `success` for
  active or verified, `warning` for something that needs attention (expired, not verified),
  `danger` for deactivated or revoked, and `accent` (outlined in the link colour) for what's about
  the viewer, like "You" on their own row. A status keeps one tone on every screen, which
  `src/components/ui/badge-tones.test.ts` checks (it reads a badge whose label is one message,
  `{t('deactivated')}`, as its English text). Icons come from
  [Lucide](https://lucide.dev) and are hidden from screen readers; icon-only buttons have an
  `aria-label`. Join classes with `cn()` (`src/lib/cn.ts`).

### Tables

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
    tables are one component, `PeopleTable` (`src/app/(app)/_people/people-table.tsx`), which
    builds the first cell with `PersonCell` (`person-cell.tsx`); each page words its texts and
    builds each row's role and action.
  - **Pages:** 25, 50 or 100 rows per page, chosen in the table's footer (`Pagination`: "Showing
    26–50 of 132", Previous, the page numbers and Next). The footer only shows with more than 10
    rows: a card gets it from `paginationFooter`, which gives nothing for a table that fits on
    one page.
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
    list arrives; without JavaScript, search is a plain GET. The spinner sits over the link's
    label, which turns transparent but stays the link's name (`LinkPendingIndicator`; hiding it
    would leave the link nameless while its page loads). A list with more to filter by than
    fits in a row of links has a `FilterMenu` per filter next to its Sort menu (the company, type
    and priority of requests): a button that names the filter and, once one is chosen, the choice
    ("Type: Bug"), with the choices as links in a menu, "All" first. It keeps focus like the Sort
    menu does. It needs JavaScript, unlike the search and the status links.
  - **Widths:** no table scrolls sideways. The content area stops growing at 1280px (`xl`,
    `max-w-5xl` in the app layout), so a table gets no more columns past that, unless its page is
    wide (`WidePage`, see "Layout" below): a wide page has its full 1200px from 1536px of screen
    (`2xl`), where what sits under the name may get a column of its own (`hidden 2xl:table-cell`,
    and `2xl:hidden` under the name). Only a table on a wide page gets `2xl:` columns. Columns
    that don't fit move under the name instead:
    - **Activity:** people tables show when someone was last active and when they joined in
      one Activity column from 1280px, and under the name below that
      (`src/app/(app)/_people/activity.tsx`).
    - **Users:** the MFA status and companies show under the name, and in their own columns from
      1536px, where the page (a wide one) has its full 1200px; the address from 768px in its own
      column.
    - **Staff and members:** the address always shows under the name (unless it is the name),
      and the role from 768px in its own column. On their wide pages (Settings, a company's
      pages) they keep these columns: their rows are already as tall as the role select.
    - **Companies:** the URL name always shows under the name, and the status and when it was
      added from 768px in their own columns, so on a phone the name keeps the room.
    - **Requests:** the number and type always show under the title, and the status, priority,
      assignees and last activity from 768px in their own columns. Across companies, the company
      shows under the title too, and in its own column from 1536px, where the page (a wide one)
      has its full 1200px. A long status ("Waiting for the company", `StatusBadge`'s `wrap`, as
      on the board) and a long row of avatars (`PeopleAvatars`' `wrap`: side by side with a gap
      rather than overlapping, so the rows line up) wrap in their columns, and so do the Assigned
      to heading and the last activity ("59 minuten geleden") below 1280px, so the table fits in
      every language at 768px and at 1024px, where the sidebar takes its room.
    - **Long values:** names, addresses and company names wrap (`wrap-anywhere`) rather than
      widening the table.
    - **Check:** `e2e/tables.spec.ts` checks every table at 640, 768, 1024, 1280, 1536 and
      1920px, with a seeded staff member who has no name and a long address, and a request of its
      own waiting for the company on the first page of the lists of requests.
  - **List services** take the table's state and return one page with the total
    (`Paged<T>`); each sort ends with the row's ID, so pages don't overlap and reversing is exact.

### The board

- **The board** of requests is the one view of records that isn't a table: a lane per status, each
  card a list item, in columns, two of which (Waiting, Closed) hold two lanes as an upper and a
  lower half, each half with its own heading (`h3` under the column's `h2`). What it shows, who may
  move what and how the lanes are laid out is in [The board](requests.md#the-board); this is the
  pattern, for any board of cards. Lanes have no pagination footer but keep the list's sort, from
  its Sort menu.
  - **Moving without dragging:** every card the reader may move has a Move menu (a Radix menu)
    listing the lanes it may go to, which works with a single click or tap, the keyboard and
    screen readers alike. That's WCAG 2.5.7 Dragging Movements: whatever can be dragged can also
    be done with a single pointer, and the keyboard alone doesn't count. Dragging is an extra for
    the pointer from tablet width; the menu stays. Moves that email the company (Done,
    Cancelled) ask first, however they're made.
  - **Dragging:** a decorative grip (`aria-hidden`, `cursor-grab`) in the card's corner drags it,
    never its title link (`draggable={false}`). The drag and drop library loads with `import()`
    once the page is there, from tablet width only (`board-drag.ts`, the one file that imports
    it). While a card is dragged, the lanes say whether it can go there by more than colour: a
    lane it may go to has a border in the highlight colour, and under the pointer a ring and what
    letting go does; a lane it can't go to has a dashed border, the not-allowed cursor and "Can't
    move here", and doesn't take the card. The card left behind is dashed and flat, its text as it
    was (never lighter through opacity). A drop that's refused sends nothing and says why, inline
    and as a toast. A live region of the board's own announces the drag in the reader's language
    (never a library's English).
  - **A busy card, not a busy board:** a moved card shows in its new lane at once
    (`useOptimistic`), and only its Move button is busy (a spinner in its icon's place, its word
    and name kept, focusable, presses ignored); every other card stays usable.
  - **Focus follows the card:** a card that changes lanes is removed and added again, so focus
    is put back on its Move button in the new lane (`data-request`), or on the lane's heading
    when the card isn't shown anymore; a lane is a `data-card` element for `restoreFocusIfLost`.
  - **Screen readers:** the columns and their halves are named groups (`role="group"` with
    `aria-labelledby` on their heading), not sections: a named section is a landmark, and a board
    of landmarks would bury the page's own. A lane's list of cards is named when it shows fewer
    than the lane holds ("First 25 of 80", "Latest 5 of 132"). What happens to a card goes
    through one live region the board keeps on the page from the start, since a status inserted
    with its text already in it is often not read out; it empties before the toast or the error
    says the outcome, so nothing is said twice. These are checked with axe and with snapshots of
    the board's accessibility tree (`e2e/board-a11y.spec.ts`); a pass with VoiceOver is manual.
  - **Width:** the columns sit in a row that scrolls sideways inside a named group the keyboard
    reaches while it overflows (`tabIndex={0}`, like a wide code block), so the page never
    scrolls sideways. A row of "Jump to a lane" buttons above it, shown by a container query
    (never a measurement after the page runs, so nothing shifts), brings a column out of sight
    one press away; the sizes are in [The board](requests.md#the-board).
  - **Colours:** a lane is a step back from its cards in both modes (`muted` behind `surface`
    cards in light mode, `surface` behind `raised` ones in dark mode, where `surface` is the darker
    of the two); the count, the empty lane and the card's details use `muted-foreground`.

### Cards and pages kept alive

- **Cards** have 24px padding on every side. Settings with actions use full-width rows (what it does
  on the left, the button on the right). Destructive settings that can't be undone, like deleting or
  deactivating an account, get their own `Card` with `tone="danger"`.
- **Ids stay unique across pages kept alive:** components that make ids with `useId` (`Card`,
  `TextField`, `TextAreaField`, `CheckboxField`, `RadioField`) are client components. In a
  server component `useId` starts again in every request, so a page kept alive and the tab
  loaded next would share ids, and a label or a card's name would point at the wrong element.
  A new component that calls `useId` gets `'use client'` too.
- **Messages don't outlive the page:** with Cache Components, Next.js keeps the last few pages alive
  (hidden with React's `<Activity>`) instead of unmounting them, so their state survives navigation.
  Typed input should, but a "Saved" or error message, or an open dialog, shouldn't still be there when
  you come back. Forms use `useTransientActionState` instead of `useActionState`, and status
  messages and dialog open state use `useTransientState` instead of `useState`
  (`src/components/ui/use-transient-state.ts`); both reset when the page is hidden. What a page
  does once when it opens (the code step emailing its code) it does again when it's shown again:
  `useOncePerVisit` runs it once each time the page is shown, also through Strict Mode's second
  run of the effects, so development doesn't do it twice. In the
  signed-in app a draft survives whole: every field of a form is kept, in plain state or by the
  browser, never some of them (Add company keeps its name, URL name and admin address together),
  and a form whose submit went through starts empty again. The signed-out pages for signing in
  are the exception (sign in, the code step, forgot password, reset password): they keep even
  their fields, busy buttons and confirmations in `useTransientState`, because they come back
  after signing out and the next person on the browser mustn't find the last user's address or
  password.
- **A change refreshes, also when it redirects:** Next.js drops the pages it kept alive only when
  a server action refreshes or revalidates (or sets a cookie); a `redirect()` alone leaves them as
  they were. An action that changes something and then redirects calls `refresh()` first (raising
  a request, deleting a user, giving a company a new URL name), or Back shows the form still
  filled in, the list without the new row, or the page of what was just deleted.
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
  setting with a select (the default language in Settings) pass `resetOnSuccess: false`: a
  cleared `SelectField` goes back to the value it showed when the page loaded (both kinds of
  select restore that on a form reset), not the one just saved. Forms that edit a saved setting in a
  text field (a name, the request prefix) keep the reset: it's what makes the field show the
  value as it was saved (trimmed, the prefix in capitals) rather than as it was typed. A bulk invite that sent some
  invitations keeps just the addresses that weren't sent. The sign-in pages are the exception to keeping typed input: the sign-in form and the code step keep their
  fields, busy state and "Trust this device" in `useTransientState` too, because they come back
  when someone goes back to them (from the code step to the sign-in page, say), and whoever does
  mustn't find the last user's details or a button still busy. They also reset a busy button when the browser restores them from its
  back/forward cache (`pageshow`, through `usePageRestored`).

### Avatars, buttons and menus

- **Avatars** (`Avatar`) show initials, or a person's picture over them (`src`, from
  `/avatars/<account>`, see [decision 0022](decisions/0022-profile-pictures-from-providers.md)). The
  picture (`AvatarPicture`) takes itself away when it can't load, also when it failed before the
  page's scripts were running, so the initials behind it show; a new address gets a new try. Avatars
  are decorative (`alt=""`): the name stands next to them, or, where several stand in a row without
  names (`PeopleAvatars`, a table's Assigned to column), each has the name as its `title` on hover
  and the names are there as text for screen readers.
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
  `collisionPadding`). The item the keyboard or pointer is on is filled (`raised-muted`) and has
  an inset 2px outline in the ring colour (`highlightedItem` in the same file, shared by menu items
  and select options). The fill alone is 1.13:1 against the panel in light mode and 1.21:1 in dark
  mode, and forced-colours mode drops it; the outline is 7.5:1 and 7.3:1 (WCAG 1.4.11) and is drawn
  in forced colours too. Items never take `outline-none` or `outline-hidden`: both switch
  Tailwind's outline style off for the element, so the outline would never show.
- **A button that opens a menu and shows less than it says names itself with `aria-label`**,
  which holds the words it shows (WCAG 2.5.3): the board's "Move" is "Move AD-142", and the Sort
  menu's "Name, A to Z" is "Sort members: Name, A to Z" (`LinkRadioMenu`'s `triggerLabel`). Never
  a copy only screen readers get next to `aria-hidden` text, as other buttons with a short label
  have it ([Languages](i18n.md)): a Radix menu is named by its button (`aria-labelledby`), and
  while it's open the rest of the page, its button included, is hidden, so the menu's name counts
  all the button's text, hidden or not ("Move Move AD-142"). A button that shows text outside its
  name, like the account menu's avatar initials, can't take a label (it would have to hold them):
  it keeps its content as its name, and its menu is labelled by the part of it that names it
  (`aria-labelledby` on `MenuContent`). `e2e/board-a11y.spec.ts` and `e2e/keyboard.spec.ts` check
  those menus' names.

### Selects and navigation

- **Long selects can be searched.** A `SelectField` with more options than `SEARCH_THRESHOLD`
  (10, in `src/components/ui/select-field.tsx`) opens
  a panel with a search field above its list (`SearchableSelect`, on Radix Popover): the list shows
  only the options whose label, or group heading, contains what's typed, ignoring case and accents,
  in their order (`matchingOptions` in `select-option-list.ts`). A shorter one stays a Radix
  Select. Both list options with a `group` under its heading (time zones by region), name their
  open list by the field's label (`aria-labelledby`, so a screen reader says which list it is in),
  and look alike: the same closed field, options, check and highlight (`select-options.tsx`).
  - **Closed,** it's a combobox named by its label that shows the chosen option, like the short
    select. Enter, Space, the arrow keys or a click open it, and typing a character opens it with
    that character in the search.
  - **Open,** the search field has the focus (WAI-ARIA's combobox pattern): typing filters at once
    and makes the first match active, the arrow keys move one option, PageDown and PageUp ten, and
    Home and End go to the first and last. The active option is filled and outlined
    (`highlightedItem`), scrolled into view under its group's sticky heading, and pointed at with
    `aria-activedescendant`. Only Enter or a click picks; Escape, Tab, Shift+Tab or a click outside
    close it without a change, and the focus goes back to the field. What the keys do, and the
    scrolling that follows them, is in `searchable-select-keys.ts`.
  - **What matched** is marked in each option's label, or in its group's heading when that's what
    matched (`<mark>`, `MatchedText` in `select-options.tsx`): semibold in the text's own colour
    (`foreground`), with no fill of its own, so it reads the same on the active option's fill and
    in both modes. While a search is on, the headings, semibold otherwise, are at normal weight
    (`searchedGroupHeading`) with their size and muted colour, so a match in one is semibold like
    a match in a label, not set apart by its colour alone. In forced colours a match takes the
    system's colours for a mark (`Mark`, `MarkText`), which the person's theme chooses: a `<mark>`
    left to itself keeps the mark's text colour on no fill there, which can't be read. The match
    is found as the search finds it and mapped back onto the text as it's written (`matchRange` in
    `select-option-list.ts`), so it covers whole letters with their accents ("sao" marks "São").
    The text, and so the option's name, stays the same, and the closed field never marks anything.
  - **What it says:** a screen reader hears how many options match once typing pauses (a status,
    after 400ms), and "No options match your search." also shows on screen.
  - **Forms, busy and coming back:** the value goes in a hidden input, so forms submit it as before,
    also before JavaScript loads. `busy` keeps it focusable but closed. The panel and what's typed
    are gone when the user comes back to the page, and each opening starts with an empty search.
  - **On a phone,** it's the same panel: as wide as the field (at least 16rem, within the 16px
    gutter), above the field when there's no room below, with the list scrolling in the room left.

- **The current item** of a navigation (`aria-current`: the page in the sidebar, a tab, a filter
  such as Active, a page number, the rows per page) stands out by a fill, a shadow or a coloured
  line, which forced-colours mode (Windows High Contrast) replaces with system colours. In that
  mode it gets the same inset 2px outline as a menu's highlighted item instead (`currentItem` in
  `src/components/ui/styles.ts`), except while it has keyboard focus, when the focus ring shows. A
  component that marks a current item adds `currentItem` to every item, next to `focusRing`.

### Colours and font

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
  vanish on them.

  The rules every palette keeps are data, `PALETTE_RULES` in `src/lib/branding/rules.ts`: text
  4.5:1 on every surface and on the buttons it's written on, input borders and focus rings 3:1,
  highlighted code 4.5:1 on `background`, and in dark mode raised layers lighter than the surfaces
  under them. Code reads the theme's colours from a copy, `THEME_PALETTE`
  (`src/lib/branding/theme-colours.ts`); `src/styles/theme.test.ts` checks that the copy has the
  same tokens and values as `theme.css`, and that the theme keeps every rule in both modes. A new
  colour token goes in both, and a rule for it in `PALETTE_RULES` when it stands on another.

  Never make text lighter with opacity (`text-foreground/60`): contrast can't be guaranteed that
  way. Brand orange is too light for small text on white, so errors use the darker `danger`.

  Highlighted code has its own tokens (`code-comment`, `code-keyword`, `code-string`,
  `code-number`, `code-title`, `code-type`, `code-attribute`), which `src/styles/code.css` gives
  to the classes highlight.js puts on the parts of a block of code. Code stands on `background`,
  in a block and in a sentence; each token is 6:1 or more on it in both modes, and the rules check
  4.5:1. A new kind of token gets its colour there, never a fixed one in a component.

- **Font:** Inter for text and JetBrains Mono for codes, URL names and references, which Adiutor
  ships (`src/lib/fonts.ts`, served from its own domain), so text looks and measures the same on
  every device and in CI; line height = font size + 8px. Emails use the device's own font, since
  email clients often block web fonts. See [decision 0016](decisions/0016-ship-inter-and-jetbrains-mono.md).

### Layout and error pages

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
  The content of every page stops growing at 1280px of screen. A page with more to show in the
  room may be wider (`WidePage` in `src/components/layout/wide-page.tsx`,
  [decision 0042](decisions/0042-wider-pages-for-lists-of-requests-and-people.md)): from that
  width it grows with the room next to the menu, up to 1200px of content, which it always has
  from 1536px of screen. A request's page grows, so the conversation and the editor of a reply
  get the room, with the details still beside them; so do the boards of requests, so more of
  their lanes show side by side, the lists of requests, whose titles and statuses stop wrapping,
  and the list of users, whose companies and MFA get columns of their own. A company's pages and
  Settings are wide on every tab, through their layout, so a company's list and board and the
  staff get the room, and the header and tabs stay in one place from tab to tab. It measures that
  room in the content column (a container in the app layout), not the screen, so a scrollbar
  never makes it scroll sideways. Other pages keep the content's usual width: a short table (the
  companies, the logs), a form or a page of details gains only empty space.
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

### Interaction and results

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
  user they're disabled all the same). Both take `describedBy` too, the ID of the text that says
  why a button is off, so someone who reaches it with the keyboard hears the reason ("Add to
  company" for a deactivated account). Don't offer a control whose only outcome is a refusal:
  leave it out (a deactivated company's memberships have no role select or Remove) or turn it off
  with its reason. Destructive actions ask
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
  `focusMainContent`; `RowAction` and `ActionDialog` call it through `useFocusAfterSuccess`), never
  to `<body>`. A form that gives way to its own confirmation (Add
  user, Add company, an invite link's "Continue") moves focus to that confirmation (`Alert`'s
  `focusOnShow`), and a button that brings the form back ("Add another") moves it to the form's
  first field. Such a form remembers which result was dismissed and shows any other one, never a
  "show the result" flag that the next submit flips: the hook keeps returning the old result
  until the new one arrives, so a flag would bring the old confirmation back while the request
  runs and lose what was typed.
  - **Signed in as someone.** While a staff member is signed in as a user, the controls that change
    something render disabled, except the request work the user may do, and the banner says so
    (see [Signing in as a user](authentication.md#signing-in-as-a-user)). The banner mounts
    `SignedInAsMarker`, and controls read `useSignedInAs` (`src/components/ui/signed-in-as.tsx`).
    `RowAction`, `ActionDialog` (both through `useChangeButtonState`) and `RoleSelect` do it
    themselves; pass `allowedWhileSignedInAs` for the user's own work. Forms that change something pass the hook's value as `disabled` to
    each field, select and submit button, so the attribute is on the control itself (Radix selects
    read their own `disabled`). They also wrap their contents in `ChangesFieldset`, a disabled
    fieldset then, which turns off anything a form missed, without a box or a group of its own.
    Reads (search, filters, sorting, paging) stay as they are, and so do the request forms and
    controls (the user's own work). The server refuses other changes either way, so a control
    that misses this still changes nothing.
  - **Card anchors.** A `Card` whose controls can send the user away and back (a confirmation, a
    provider, an emailed link) gets an `id`, a section ID like `invitations` (see
    [Coming back to where you were](authentication.md#coming-back-to-where-you-were)). The
    return addresses its controls send end in it. A table that isn't a page's main table names its
    card in its definition (`TableDefinition.section`, `table.section`), and its sort and page
    links end in that anchor too, which only matters in a new tab, since in the app they don't
    scroll.
  - **One anchor, one card, across the app.** A card's `id` is unique across the app, not just its
    page: Next keeps the pages shown last in the document, hidden in `<Activity>`, so the same id
    on two pages repeats, and Next's own scroll to an anchor (`getElementById`) can find the
    hidden card. A card shared by two pages takes its anchor from the page: the same table gets
    a definition per page, with the same prefix (so the same address parameters) and its own
    section (`DEVICES_TABLE` on your account's Activity page, `USER_DEVICES_TABLE` on a user's
    Activity tab; `INVITATIONS_TABLE` and `INVITE_LINKS_TABLE` on the staff settings,
    `COMPANY_INVITATIONS_TABLE` and `COMPANY_INVITE_LINKS_TABLE` on a company's Members page,
    whose invite card is `company-invite`). `src/lib/tables/tables.test.ts` checks that no two
    tables' sections and no two files' fixed `Card` ids (a string, or a constant declared as one)
    are the same, and `e2e/keyboard.spec.ts` keeps such pages alive together and checks that no
    id repeats in the document.
  - **Landing.** When the user comes back to the page with that anchor in the URL, the card
    (`AnchoredSection` in `src/components/ui/anchored-section.tsx`) lands them on it. That is on
    mount or when `<Activity>` shows the page again, one frame later, because Next.js scrolls to
    an anchor only when the card is already on the page and never moves focus.
    - With focus nowhere (on `<body>`, or on a control of the page left behind), it scrolls the
      card into view and focuses its heading.
    - With focus already inside the card (a result `Alert` with `focusOnShow`), it only scrolls.
    - Otherwise it leaves the page alone.
  - **Sticky header.** Two layers stick to the top of the screen: the top bar below `lg` (3.5rem
    tall) and, while a staff member is signed in as a user, the banner at every width. A browser
    counts a control under them as visible, so a keyboard user who goes back to it (Shift+Tab)
    wouldn't see it (WCAG 2.4.11). The page therefore tells the browser how much of its top is
    covered: `html { scroll-padding-top: var(--sticky-top) }` in `src/app/globals.css`, which is
    where the banner sticks (4rem below `lg`, 1rem from `lg`), plus the banner's height while it
    shows, plus 0.5rem of room for a focus ring. `SignedInAsMarker` measures the banner (it wraps
    differently per width and language) and keeps its height in `--signed-in-as-banner-height` on
    `<html>` while it's mounted. Everything the browser scrolls to lands below the layers: a
    control that gets focus, an anchor, `scrollIntoView`. When you change the top bar's height or
    where the banner sticks, change `--sticky-layer-top` with it.
    Cards add a small margin of their own to that (`scroll-mt-2 lg:scroll-mt-4`), so they land
    5rem from the top below `lg` and 2.5rem from `lg` up, and lower while the banner shows. Don't
    give an element the top bar's height as its `scroll-margin-top`: it would count twice.

  Pages with section tabs (a company's Requests, Members and Settings; the account's Profile,
  Preferences, Security and Activity; a user's Overview, Companies, Activity and Manage; the Logs;
  Settings' General, Staff and Requests) get their header and tabs from a layout
  (`companies/[companyId]/layout.tsx`, `account/layout.tsx`, `admin/users/[userId]/layout.tsx`,
  `admin/logs/layout.tsx`, `admin/settings/layout.tsx`), which stays mounted while the page under it changes: the tab you chose
  keeps focus and the header doesn't reload. The layouts of a company's pages and of Settings
  make every one of their tabs wide (`WidePage`, see "Layout"), so the header and tabs don't move
  when the tab changes. `SegmentTabNav` marks the current tab from the URL
  (`useSelectedLayoutSegment`), and each page still checks its own permission. Tabs that don't
  fit the width (long names on a phone, in some languages) wrap onto another row rather than
  widen the page.

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
  "Notification" and the one word "Error" in its place, politely, so it waits for the inline
  error being read out instead of cutting it off. `RowAction`, `ActionDialog` and the selects that
  save when a value is picked (`useSaveOnPick`: `RoleSelect`, the request's `StatusSelect`) toast
  as soon as their action returns, so the toast outlasts a row the refresh removes (`RowAction`'s
  `doneMessage` names the row, e.g. "Invitation to jane@adiutor.dev revoked."); `ResultAlert`
  toasts a form's result, `Alert`'s `alsoToast` an error a component shows itself, and
  `ToastOnArrival` a confirmation that comes with a redirect ("User deleted."): the page names the
  query parameter that asked for it (`?deleted=1`), which leaves the address once it's toasted
  (`history.replaceState`, keeping the other parameters and the `#section`), so a reload or a
  copied link doesn't say it again. An action that
  ends with a full page load (`loadFresh`) leaves its toast for the next page with
  `showToastAfterLoad`, which the `Toaster` there shows once ("You're back in your own account.");
  it's kept in the tab's `sessionStorage` and counts for 30 seconds. Results to act on
  stay inline: a new company's "Open the company", a new invite link to copy. A copy button
  (`CopyButton`) says what it did in its own label, announced to screen readers: "Copied" for two
  seconds, or "Couldn't copy" for five when the browser refuses, then also as an error toast where
  the page has toasts; what it copies stays on screen next to it, to select by hand. It's a
  secondary button by default, and small and quiet (`size="sm"`, `variant="ghost"`) in the caption
  row of a block of code, where it mustn't draw the eye from the code. The signed-out
  pages (sign in, the code step, password reset, invitations, `/setup`) show their results inline
  only.
- **Tap targets:** every control is at least 24×24px (WCAG 2.5.8) without leaning on the rule's
  spacing exception, so each is easy to tap on a phone. Text links on their own line reach 2px above
  and below the text (`TextLink`, cancelled by a negative margin, so nothing moves), and a checkbox
  or radio button counts with its label (`CheckboxField`, `RadioField`). Links inside a sentence are exempt, as in WCAG. That
  2px reaches 24px only on a link that's a block, which takes the whole line's height: an inline
  link adds it to the font's height instead (21px for small text). So a link in a row of details
  rather than a sentence, like the audit log's "by … · about … · company" line, is a flex item (its
  part a `flex items-baseline gap-x-1` row), and a row that wraps keeps 4px between its lines so
  the links don't overlap. The 24px check takes every inline link for one in a sentence, so it
  can't catch an inline link there.
- **Links in text:** a link inside a sentence is underlined (`TextLink`: thin at rest, thicker on
  hover), because its colour alone doesn't set it apart from the text around it: `highlight` is
  2.2:1 against body text in light mode and 1.6:1 in dark mode, and WCAG 1.4.1 asks for 3:1 or
  another cue. That goes for links in a message's `<link>` tag (`t.rich`) and for a link that
  shares a line of text with them (the company in an audit log entry's "by … · about …" line). A
  link that stands on its own takes `standalone` and is underlined on hover only: a name in a
  table, a value in a list of details, "Forgot password?" under its field, a link with a line to
  itself. When you add a `TextLink`, decide which of the two it is.

### Text, forms and titles

- **Markdown** is shown with `MarkdownText` (on the server only) and written in `MarkdownField`,
  both in `src/components/ui/markdown/`; see [Requests](requests.md#text). The field's editor
  loads after the page, in place of a plain text field under the same toolbar, so nothing moves.
  Its toolbar is the `Toolbar` component (`src/components/ui/toolbar.tsx`, Radix Toolbar): one
  stop for Tab with the arrow keys between its buttons, each an icon named by its label, and a
  button that switches something says whether it's on (`aria-pressed`, shown by a fill and a line
  in the colour of control borders, 3:1). Tab always leaves the text. A task's checkbox in the
  editor is 24px, the least a target may be.
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

### Motion

- **Motion:** short transitions only, and none at all when the device asks for reduced motion.

Two end-to-end specs keep this true: `e2e/a11y.spec.ts` scans every page (and open menus, selects,
dialogs and the mobile menu) with [axe](https://github.com/dequelabs/axe-core) against the WCAG 2.2
A and AA rules in light and dark mode, and that every control is at least 24×24px, and checks that no page scrolls sideways on a 320px-wide
screen, in every language (with the sign-in page's widest buttons, "Last used" badge included) and
while signed-in pages still show their loading placeholders, and that no field's text is under 16px.
The pages are scanned as the staff Admin, and the ones that look different to someone at a company
(the dashboard, the requests) also as a Client and as a Watcher.
`e2e/keyboard.spec.ts` checks the skip link, menus, selects (also a searchable one), dialogs, the mobile menu, the request
controls, the board (its Move menus, its row and the buttons that jump to a column) and cursors using only the keyboard, that a button keeps focus while its form saves, and
that an error in a dialog takes focus each time it comes and leaves the dialog one Escape away.
`e2e/board-a11y.spec.ts` pins down what the board tells assistive technology with snapshots of its
accessibility tree (`toMatchAriaSnapshot`): the row that jumps to a lane, the columns and their
halves with their names and counts, a lane that shows fewer cards than it holds and an empty one, a
card and its Move menu, the status while a card is moved and the focus after it, and the phone's
folding columns. Like axe, the snapshots read the markup, not what a screen reader says: a pass
with VoiceOver on the board is manual.

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
  the right colours. Without JavaScript (or when the script can't read storage), nothing sets
  `data-theme` and CSS follows the system setting: the colours through `light-dark()`, and the
  `dark:` variant through `prefers-color-scheme` while `<html>` has no `data-theme`
  (`@custom-variant dark` in `src/styles/theme.css`), so a dark page gets the logo with light text
  there too.
- **Colours:** each semantic colour is defined once in `src/styles/theme.css` as
  `light-dark(<light>, <dark>)`, so both values sit side by side when you check contrast. Brand
  colours a staff Admin chose replace some of them with pairs of their own (see
  [Brand colours](#brand-colours)), so the mode still decides.
- **Styling:** use the semantic colours (see [Design and accessibility](#colours-and-font))
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

The icon in a browser's tab is `src/app/icon.svg` (the same picture as `public/brand/icon.svg`),
and, for browsers and tools that ask for `/favicon.ico` instead, `src/app/favicon.ico`: that icon
drawn at 16, 32 and 48 pixels, the three as PNG pictures in one `.ico` file. Next.js serves both
and adds their links to every page (its file convention for icons). When the icon changes, make
the `.ico` again from the SVG.

`src/styles/theme.css` is the Tailwind theme: the brand colours (`brand-teal`, `brand-green`,
`brand-orange`, `ink`), the fonts (Inter and JetBrains Mono, then the system fonts as fallbacks),
text sizes with line height = font size + 8px, short entrance animations, and the semantic colours
described under [Design and accessibility](#colours-and-font). Components never use the brand
colours directly, since a staff Admin's brand colours replace them: UI uses the semantic colours,
and the signed-out pages' brand panel its own tokens (`brand-panel`, `brand-panel-glow` and
`brand-panel-glow-deep`, the same in both modes).

### Brand colours

Adiutor can run in the colours of whoever operates it ([decision
0047](decisions/0047-brand-colours-from-an-accent-and-a-tint.md)). A staff Admin chooses up to three
colours, kept as the `brand.accent`, `brand.accent_dark` and `brand.tint` settings; `null` is the
theme's own. The palette every page shows is worked out from them by `derivePalette`
(`src/lib/branding/palette.ts`), in OKLCH (`colour-space.ts`), where the same lightness looks
equally light in every hue:

- **Tint:** every grey (`background`, `surface`, `muted`, `raised`, `raised-muted`, `border`,
  `border-strong`, `foreground`, `muted-foreground`, `code-comment`, the dark text on light buttons,
  the overlay and the brand panel) keeps the theme's lightness and chroma and takes the tint's hue.
  The tint's own chroma sets how much colour the greys take, up to as much as the theme's navy has
  (a grey tint gives plain greys), and never more than 60% of what a grey's lightness and hue allow,
  so a warm tint gives warm greys rather than a deep brown.
- **Accent:** `primary`, `primary-hover`, `primary-foreground`, `highlight`, `ring` and the brand
  panel's glows. The accent keeps its hue and its share of the chroma its lightness allows (a
  vivid colour stays vivid); its lightness moves a step at a time, darker in light mode and lighter
  in dark mode, until links, focus rings and the text on buttons keep the rules. The text on it is
  white or the darkest grey, whichever reads better, and hover is a step darker (light mode) or
  lighter (dark mode). Without a dark accent, dark mode starts from the accent. `adjusted` says
  when a mode's accent had to move.
- **Kept:** `danger`, `success`, `warning` and their fills, and the code colours other than comments.

A grey that would still break a rule is nudged in lightness, away from what it stands on, until it
keeps it. The tests (`src/lib/branding/palette.test.ts`) work out palettes for tints and accents of
every hue, greys, black, white and yellow, and check that each keeps every rule in `PALETTE_RULES`,
and that the theme's own ink as a tint gives the theme's greys back.

Staff Admins choose them on the **Appearance** tab of Settings (`/admin/settings/appearance`,
`setBrandColours` in `src/server/branding/`, recorded in the audit log as `brand_colours_changed`):
three `ColourField`s (`src/components/ui/colour-field.tsx`: a text field for the hex digits, with a
swatch before it that is the browser's own colour picker, an invisible `<input type="color">` over
a square of the colour, which shows the focus ring), each empty for the theme's own, and a preview
of the palette in light and dark mode that follows what's typed (`palette-preview.tsx`: real
components with the palette's colours set on them as custom properties, `inert`). Under each mode it
says when the accent had to move, and to which colour. "Use Adiutor's colours" empties the fields,
which Save then saves like any other change. A dark accent needs an accent, and a colour that isn't
six hex digits is refused with a message that names its field. It isn't part of setup: setup is one
narrow form, with no room for a preview.

The root layout reads the settings once per request (`pageBrandCss` in
`src/server/branding/page-colours.ts`, the theme's colours when the database can't be read) and adds
`paletteCss`'s rule in a `<style>` in `<head>`: `:root:root { … }` with only the tokens that differ
from the theme, as `light-dark()` pairs, which outranks `theme.css` wherever the two end up. It
holds only hex colours that `paletteCss` wrote and checked, so nothing chosen can close the rule.
With nothing chosen there's no `<style>` at all. `global-error.tsx`, which replaces the whole
document and can't reach the database, keeps the theme's colours, and so do the logo and the
favicon.

The brand assets aren't covered by the code's MIT License; see [License](../README.md#license) and the list of files in [NOTICE](../NOTICE).
