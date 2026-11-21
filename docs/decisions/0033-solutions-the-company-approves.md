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

## Consequences

- Waiting for approval is an active status: lists, the Waiting tab and the dashboard count it.
- The company can still cancel a request that waits for approval, but approves rather than marks
  it as done.
- A new kind of status change has its own sentence, chosen in one place for the page and the
  emails (`statusChangeKind`).

## Alternatives considered

- **Waiting for the company, with a mark on the reply:** no new status, but lists and filters
  couldn't tell a question from a solution.
- **Closing the request and letting the company reopen it:** the request would read as done before
  anyone checked.
