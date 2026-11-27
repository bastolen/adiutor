# 0059. One kept SFTP connection per storage

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

The SFTP driver ([decision 0044](0044-attachments.md)) opened a new SSH connection for every call
and closed it afterwards: a host key check, a key exchange and a login, about 35 ms on a nearby
server and more on a far one. A request's page loads a preview per file, so a page of ten files
opened ten connections, and since the viewer plays videos ([decision 0058](0058-files-open-in-a-viewer.md))
every seek is a request for a part of the file, which opened one more. The bucket and the local
disk have no such cost.

## Decision

The driver keeps one connection and its calls share it (`sharedConnection` in
`src/server/storage/sftp-connection.ts`):

- **Opened when a call first needs it, held while anything uses it:** every call holds it while it
  runs, a file being read until its stream ends, is cancelled or stops being read (the 30-second
  idle limit), and a session (a job's run, the check before a storage is saved) until it's done.
  Calls at the same time share its one SFTP channel, which `ssh2` sends requests on side by side.
- **An upload has a connection of its own,** opened for it and ended when it's stored, as before:
  it may take minutes on a slow link, and one that runs out of time (120 seconds) ends only its own
  connection, never the downloads on the kept one. It isn't run again.
- **Closed a minute after its last use** (`keep` in the driver's time limits). The timer never
  keeps the process running.
- **A connection that ends is forgotten:** however it ends (here, by the server, or by the
  network), the next call opens another. While it's kept, a keepalive every 15 seconds notices a
  server that went away within about 30 seconds. One left idle longer than a minute (its timer was
  held up: the process was frozen between requests, as on serverless) isn't used again.
- **A call that fails as its connection does stops it being kept** (it times out, or fails
  without one of SFTP's status codes): the next call opens another, and the old one ends once the
  reads still on it are done, so a look that ran out of time on a busy server doesn't cut other
  people's downloads. **When the connection was kept from an earlier use, the call runs once more
  on a new one**; on a connection opened for it, it fails. Every call that shares it is safe to repeat (a look, a read, a
  delete, the marker). A failure the server answers with (a file that isn't there, a folder
  without the marker) isn't repeated. A session isn't run again: a job tries again on its next
  run.
- **A driver that's replaced lets go of it** (`FileStorage.close`): the kept driver closes the one
  it replaces after Settings change, and a driver built for one job (the check before a storage is
  saved, the development seed) closes when it's done. Its connection ends once the calls and reads
  still holding it are done, so a download under way finishes, and a call on it after that (code
  that still held the old driver) gets a connection that ends with the call instead of being kept.
- **The host key is still checked on every connection,** and the folder's marker on every call.

## Consequences

- A page of previews, a video's seeks and downloads in a row share one connection; only the first
  call after a quiet minute pays for connecting.
- A server-wide process holds an idle SSH connection for up to a minute after its last file. On a
  platform that freezes an instance between requests (serverless), a connection kept across a
  freeze may be dead when the next request comes: the call notices and connects again, unless
  the network only drops it silently, when it waits for the call's time limit (15 seconds) first.
- A connection that stops answering keeps the reads already on it until each stops for 30 seconds
  (the idle limit), when it ends; new calls go to a new connection at once.
- A server that's never told a connection went (an instance destroyed while frozen) keeps it open
  until its own TCP keepalive gives up, by default after hours: on serverless, set the SFTP
  server's `ClientAliveInterval` ([Deploying](../deploying.md#attachments)).
- Every download in a server process now goes through one `sftp-server` process on the server, so
  they share its limit on open files: a reader who keeps many slow downloads open could reach it
  sooner than when each had a connection (and a process) of its own. Each read is still cut when
  it stops for 30 seconds.
- Settings that change take effect with the next call, as before; the old connection lingers only
  until what's using it is done.

## Alternatives considered

- **A pool of several connections:** more parallel throughput for many large downloads at once,
  but one channel already carries many requests side by side, and a pool needs a size to tune.
- **Keeping connections open for good:** a server that drops idle connections would make every
  first call after a quiet spell fail and retry, and a stopped storage would be held for nothing.
- **Caching the marker check per connection:** one round trip fewer per call, but a folder whose
  volume went away would take files until the connection closed.
