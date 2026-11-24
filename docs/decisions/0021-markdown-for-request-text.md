# 0021. Markdown for request text: rendered on the server, written in an editor

- **Status:** Accepted
- **Date:** 2026-11-18

## Context

Descriptions and replies were plain text with a format marker, so that Markdown could follow as a
second format ([decision 0019](0019-requests-one-series-plain-text-and-a-history.md)). People who
raise requests paste logs, commands and configuration, and want lists, headings and code that reads
as code. Many of them don't know Markdown. A request's text is written by one side and read by the
other, so what one person types must never run, track or mislead in someone else's browser.
Descriptions and replies are never edited, so a writer has to see what they send before it's sent.

## Decision

How it works is in [Requests](../requests.md#text). The choices behind it:

- **Every new text is Markdown; older texts stay plain.** Nobody chooses a format. Texts stored
  before keep their `plain` marker and their own renderer, so no stored text is read as something
  it wasn't written as.
- **Markdown means CommonMark with GitHub Flavored Markdown's additions,** and a line break stays a
  line break.
- **Rendered on the server from a tree, never from HTML,** with the unified libraries, into React
  elements of our own components. None of them reaches the browser.
- **What the writer typed is shown, never run.** HTML in a text shows as the text it is, only
  `http` and `https` addresses become links, and an image is a link to it and is never loaded. An
  allow-list of elements and attributes runs before the highlighter, whose markup is the only
  markup added after it.
- **A text that would cost too much is shown as plain text.**
- **Code is highlighted by highlight.js,** through class names coloured by theme tokens.
- **Written in an editor that formats while typing** (Tiptap), loaded only where the field is, with
  the plain text field as its fallback. The editor only produces Markdown, which the server cleans,
  limits and renders like any other text.

## Consequences

- Two renderers stay: the plain one for texts stored before, the Markdown one for the rest.
- The rendering libraries must stay out of client components, and the editor's libraries load only
  with the field (`src/client-imports.test.ts` enforces both).
- `pnpm audit` has to stay clean for two more families of packages.
- The editor reads Markdown with its own parser, so in rare cases a text looks different while
  typing than after it's sent. The server's rendering is the one that counts.
- The editor has no footnotes and builds no table from scratch, though both are still shown when a
  text has them.
- The editor and the languages of highlighted code are large, so neither comes with a page: the
  field loads the editor once the page is there, and the editor the languages once a text has a
  block of code.
- Mentions and emails about requests come later. The format marker leaves room for a marker for a
  person, and Markdown reads as plain text in an email's plain-text part.

## Alternatives considered

- **`react-markdown`:** the same libraries behind one component, which leaves no place to catch a
  text nested so deeply that the parser's own tree walk overflows the stack.
- **`markdown-it`, `marked` or `micromark`:** they return HTML strings, which need
  `dangerouslySetInnerHTML` (refused by ESLint) and a separate sanitizer.
- **Shiki, Prism or sugar-high for highlighting:** Shiki has the most precise grammars, but renders
  asynchronously, writes colours as inline styles and loads heavier grammars; Prism's development
  has stalled; sugar-high has no grammars per language.
- **Lexical as the editor:** still 0.x, its Markdown support is a set of patterns rather than a
  parser, and its code blocks use a different highlighter than the server.
- **Write and Preview tabs, with the preview rendered on the server:** nothing new in the browser,
  but the writer has to know Markdown and switch back and forth.
- **A format the writer chooses per text:** a question nobody raising a request should have to
  answer.
- **Reading older texts as Markdown too:** a stored text with `*`, `_`, `#` or a line of dashes
  would look different from what was sent.
- **Loading images:** an external image gives its host the IP address of everyone who reads the
  request.
