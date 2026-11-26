# 0051. Profile pictures: the one in use for everyone, each choice for its owner

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

[Decision 0022](0022-profile-pictures-from-providers.md) serves people's pictures from Adiutor's
own address, `/avatars/<account ID>`, fetched from GitHub or Google when a browser asks and never
stored. The address served only while the account was its owner's current picture. But the
account page previews every picture someone can choose, from those same addresses. A preview of a
picture not in use loaded only from the browser's own copy, kept for a day since it was last in
use. Once that copy expired, the preview showed initials. Someone who never used their second
account's picture, or who chose initials, didn't see those pictures at all.

## Decision

Everything in 0022 holds except who gets which picture:

- **The picture someone shows** is served to everyone signed in, as before: readers get it
  wherever they get the name.
- **The other pictures they can choose** (each provider's first confirmed account,
  `choiceAccounts` in `src/server/people/pictures.ts`) are served to their owner alone, whichever
  picture they show, so the account page previews each choice (`loadPicture` takes the viewer).
- **A staff member signed in as them** gets only the picture in use, as the user's page shows the
  staff. The account page gives them no address for the others (`ownPictureChoices`), and shows
  initials in those previews.

Anything else is "not found". Details:
[Security measures](../security-measures.md#pictures-from-providers).

## Consequences

- Serving depends on who asks as well as the account, so the answer stays `private` (browsers
  only, never a shared cache), as it already was.
- The account page costs a fetch from each provider whose picture the browser hasn't kept, the one
  in use or not.
- Others still learn nothing from the address: a picture someone doesn't show never reaches anyone
  else, not even the staff signed in as them.

## Alternatives considered

- **Serve every connected account's picture to everyone signed in:** simpler, but it would show
  pictures someone chose not to show, to anyone who has the address.
- **Keep copies of the pictures in Adiutor:** that's storing files from the providers, which 0022
  avoided, and copies would still need refreshing when they change.
- **Let staff signed in as the user see the previews too:** the account page would match the user's
  view, but staff would get pictures the user doesn't show anyone.
