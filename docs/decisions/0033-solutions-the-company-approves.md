# 0033. Solutions the company approves

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

The staff could only close a request themselves (Done), or ask the company something and wait
(Waiting for the company). When they believed they'd fixed it, they had two poor choices: close it
before the company had checked, or leave it open and ask in a reply, which the company answered in
free text the staff then had to read and act on. Decision 0019 left room for an approval step.

## Decision

How it works is in [Requests](../requests.md#solutions). The choices behind it:

- **A status of its own,** Waiting for approval (`proposed`): it shows in lists, filters and badges
  like the other statuses, so nobody has to read the conversation to know a request waits on the
  company's answer.
- **It comes with the solution's text:** the staff set it only by sending a reply as the solution,
  never from the status select, so the company always has something to approve.
- **The company's Admins and Clients answer,** like Mark as done: Watchers only follow, and the
  staff, who sent it, don't approve their own solution.
- **Approve closes, deny reopens the work:** approving makes the request Done; denying puts it back
  In progress, with an optional reason saved as their reply. A plain reply leaves the solution
  waiting: only the buttons answer, so an answer is never guessed from words.
- **Request work, no audit event:** the history is the record, and a staff member signed in as the
  user may answer for them, recorded as such (decision 0028).
- **Approve and Deny in the email, without signing in:** the email that tells an Admin or Client of
  a solution has two buttons. Each is a link of its own (`/answer/<token>/approve` and `/deny`,
  token stored hashed in `request_answer_link`) that works once, only for that person and that
  proposal, for 14 days, and only while the request still waits for that proposal and the person
  may still answer it. It answers with the same service and rules as the page (`answerByLink`
  through `answerSolution`), and the link is used in the answer's transaction.
- **A person's click answers; a scanner's visit doesn't:** mail scanners open links to check them.
  A link answers on a `GET` only when the browser marks it as a person's navigation
  (`Sec-Fetch-User: ?1`, `isPersonsClick`); any other visit ends on the link's page, which asks for
  a button press first (the same idea as the sign-in link's "Continue signing in").

## Consequences

- Waiting for approval is an active status: lists, the Waiting tab and the dashboard count it.
- The company can still cancel a request that waits for approval, but approves rather than marks
  it as done.
- A new kind of status change has its own sentence, chosen in one place for the page and the
  emails (`statusChangeKind`).
- The answer links are the first email links that act without signing in. Decision 0031 didn't
  build one for unsubscribing because it would act for whoever has the email; that's true here
  too, and accepted because the user asked for answers in one click. What a link can do is kept
  small instead: one answer to one proposal, as its person, so a link that leaks (a forwarded
  email) can't read the request, sign anyone in or answer anything else, and stops working once
  it's used, the proposal is answered or withdrawn, or 14 days have passed.
- A scanner that drives a whole browser can still look like a person and answer. That's accepted:
  it's rare, the answer is in the history with the person's name, and the staff can change the
  status back.
- Failed lookups of a link count against the visitor's IP address (`answerLinkMissesPerIp`), so
  tokens can't be guessed by trying them.

## Alternatives considered

- **Waiting for the company, with a mark on the reply:** no new status, but lists and filters
  couldn't tell a question from a solution.
- **Closing the request and letting the company reopen it:** the request would read as done before
  anyone checked.
- **Email buttons that open the request, where the company signs in to answer:** safe from
  scanners, but every answer costs a sign-in and a second step; the user wanted an answer in one
  click.
- **An email link that always asks for a button press:** as safe from scanners, but two clicks for
  everyone, when browsers can tell a person's click from a scanner's visit.
