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
- **Closed a minute after its last use** (`keep` in the driver's time limits). The timer never
  keeps the process running.
- **A connection that ends is forgotten:** however it ends (here, by the server, or by the
  network), the next call opens another. While it's kept, a keepalive every 15 seconds notices a
  server that went away.
- **A call on a kept connection that turns out dead runs once more on a new one:** one that fails
  as its connection does (it times out, or fails without one of SFTP's status codes) ends that
  connection and runs again. Every call is safe to repeat: a file is stored beside its place
  first, then renamed into it. A failure the server answers with (a file that isn't there, a
  folder without the marker) isn't repeated. A session isn't run again: a job tries again on its
  next run.
- **A driver that's replaced lets go of it** (`FileStorage.close`): the kept driver closes the one
  it replaces after Settings change, and a driver built for one job (the check before a storage is
  saved, the development seed) closes when it's done. Its connection ends once the calls and reads
  still holding it are done, so a download under way finishes.
- **The host key is still checked on every connection,** and the folder's marker on every call.

## Consequences

- A page of previews, a video's seeks and downloads in a row share one connection; only the first
  call after a quiet minute pays for connecting.
- A server-wide process holds an idle SSH connection for up to a minute after its last file. On a
  platform that freezes an instance between requests (serverless), a connection kept across a
  freeze may be dead when the next request comes: the call notices and connects again, unless
  the network only drops it silently, when it waits for the call's time limit (15 seconds) first.
- A call that times out ends the shared connection, and with it the reads still going on it,
  which answer as a storage that failed. They'd have been on a connection that stopped answering.
- Settings that change take effect with the next call, as before; the old connection lingers only
  until what's using it is done.

## Alternatives considered

- **A pool of several connections:** more parallel throughput for many large downloads at once,
  but one channel already carries many requests side by side, and a pool needs a size to tune.
- **Keeping connections open for good:** a server that drops idle connections would make every
  first call after a quiet spell fail and retry, and a stopped storage would be held for nothing.
- **Caching the marker check per connection:** one round trip fewer per call, but a folder whose
  volume went away would take files until the connection closed.
