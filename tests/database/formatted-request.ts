/**
 * @file The texts of an example request written in Markdown, with every kind
 * of formatting a request can show: headings, lists, a table, a quotation,
 * links, an image, things to do, a footnote, and blocks of code (one too
 * wide for the page, which has to scroll). Used by the development seed
 * (`scripts/sample-requests.ts`) and the end-to-end seed
 * (`e2e/support/seed.ts`), so the pages are looked at with the same text
 * they're tested with.
 */

/** What's asked: a heading, a numbered list, code in a sentence, a table and an address. */
export const FORMATTED_DESCRIPTION = `We want to move the intranet before **1 July**.

## What we need

1. A copy of the current site on the new server
2. The address \`intranet.adiutor.test\` pointed at it
3. A test by our own people

| Step | Who | When |
| :-- | :-- | --: |
| Copy the site | Adiutor Tests | 20 June |
| Test it | Us | 24 June |

More about the server: https://adiutor.test/docs/intranet`;

/**
 * The staff's reply: two blocks of code (the second wider than the page), a
 * quotation, things to do and an image.
 */
export const FORMATTED_STAFF_REPLY = `The copy is running. This is the configuration we used:

\`\`\`nginx
server {
  listen 443 ssl;
  server_name intranet.adiutor.test;

  location / {
    proxy_pass http://127.0.0.1:3000;
  }
}
\`\`\`

To check it from your side:

\`\`\`bash
curl --include --header "Accept: application/json" --header "X-Checked-By: Adiutor Tests" --max-time 10 https://intranet.adiutor.test/health
\`\`\`

> The address \`intranet.adiutor.test\` pointed at it

That's done as well. What's left:

- [x] Copy the site
- [x] Point the address at it
- [ ] Your test

![The new home page](https://adiutor.test/intranet-home.png)`;

/** The company's answer: emphasis and a footnote. */
export const FORMATTED_CLIENT_REPLY = `Tested by three of us, and *everything* works[^1].

[^1]: Except the logo, which is still the old one.`;
