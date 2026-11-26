# 0022. Profile pictures from providers, served through Adiutor

- **Status:** Superseded by [0051](0051-profile-pictures-each-choice-for-its-owner.md)
- **Date:** 2026-11-20

## Context

Avatars showed initials only. People wanted pictures, but Adiutor doesn't handle uploaded files yet.
The GitHub and Google accounts people connect already have pictures. Loading those straight from
GitHub or Google would mean every viewer's browser contacts them, and the Content Security Policy
would have to allow their image hosts ([0006](0006-nonce-based-content-security-policy.md)).
GitHub's picture addresses also contain the GitHub account's number, which company users must not
learn about the staff (names only, see [Requests](../requests.md#cleaning-limits-and-names)).

## Decision

A connected account's picture address is noted from the provider's profile at every sign-in or
connection, like its name, and kept only when it's an `https` address on that provider's own
picture hosts (`account.accountImage`, `imageFromProfile`).

Someone shows the picture of the confirmed account they connected first, the one they chose on the
account page, or their initials (`pictureAccount`, `user.avatarSource`).

Adiutor serves that picture from its own address, `/avatars/<account ID>`. The server fetches it
from the provider when a browser asks, within a time limit, a size limit and an allow-list of image
types, without following redirects, and stores nothing (`loadPicture` in
`src/server/people/pictures.ts`). The address serves only while the account is its owner's current
picture, and only to someone signed in. Details:
[Sign-in and accounts](../authentication.md#security-accountsecurity), "Pictures".

## Consequences

- Browsers only load images from Adiutor, and the CSP stays `img-src 'self'`.
- Every picture a browser hasn't kept costs a request to the provider, from the server. Browsers
  keep each picture for a day, and its address changes when the provider's does.
- The account ID in the address is opaque: it isn't the user's ID, and it serves only the picture.
- A picture shows a person as much as their name does, so readers get it wherever they get the name.

## Alternatives considered

- **Load from the provider directly:** simpler, but viewers' browsers would contact GitHub or
  Google, the CSP would have to allow their hosts, and company users would see GitHub account
  numbers.
- **Copy the pictures into Adiutor:** that's storing files, which waits for uploads.
- **Use Better Auth's `user.image`:** it holds a single picture, without a per-account choice.
