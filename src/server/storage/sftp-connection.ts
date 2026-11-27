/**
 * @file The one SFTP connection a driver keeps and its calls share
 * (decision 0059): opened when a call first needs it, held while anything
 * uses it (a call, a file being read), and closed once nothing has for a
 * while, so a page full of previews, a video's seeks and a few downloads in
 * a row don't each open one. A connection the server or the network ends is
 * forgotten, and the next use opens another, and so is one a use stopped
 * trusting (`discard`), which ends once the uses still on it are done. One
 * left idle longer than it should have stayed (a process frozen between
 * requests, as on serverless) isn't used again. Closing the keeper (a driver
 * that's replaced) ends its connection once the uses still holding it are
 * done, and any connection a use opens after that ends with it.
 */
import type { SFTPWrapper } from 'ssh2';

/** An open SFTP connection. */
export interface Connection {
  /** Its SFTP channel. */
  sftp: SFTPWrapper;
  /** Ends it. */
  end: () => void;
  /** Whether it has ended: ended here, by the server, or by the network. */
  readonly closed: boolean;
  /**
   * Calls a listener once it has ended (at once when it has already).
   *
   * @param listener - What to call.
   */
  onClose: (listener: () => void) => void;
}

/** A use of the kept connection, which holds it open until it's let go. */
export interface Lease {
  /** The connection. */
  connection: Connection;
  /** Whether no use was done with it before this one: it wasn't kept from an earlier use. */
  fresh: boolean;
  /** Lets go of it; only the first call counts. */
  release: () => void;
  /**
   * Stops keeping it at once, for a call that found it failing (it ran out
   * of time, or went): the next use opens another, and it ends once the uses
   * still on it (other people's reads) are done.
   */
  discard: () => void;
}

/** A driver's kept connection. */
export interface SharedConnection {
  /**
   * Takes the connection for a use, opening one when there's none (or the
   * kept one has ended).
   *
   * @returns The use, to let go of once it's done.
   */
  lease(): Promise<Lease>;
  /** Ends the connection once nothing uses it, and keeps none from now on. */
  close(): void;
}

/** A connection being kept, with what holds it. */
interface Kept {
  /** The connection, or its opening. */
  opening: Promise<Connection>;
  /** How many uses hold it. */
  uses: number;
  /** Ends it after the idle time, while nothing uses it. */
  idle: ReturnType<typeof setTimeout> | null;
  /** Whether it ends as soon as nothing uses it (its keeper was closed, or a use stopped trusting it). */
  closing: boolean;
  /** Whether a use has been done with it, so a later one isn't its first. */
  served: boolean;
  /** When the last use let go of it, while nothing uses it. */
  idleSince: number | null;
}

/**
 * A kept connection for a driver.
 *
 * @param open - Opens a new connection.
 * @param keepMs - How long a connection nothing uses stays open.
 * @returns The keeper.
 */
export default function sharedConnection(
  open: () => Promise<Connection>,
  keepMs: number,
): SharedConnection {
  let current: Kept | null = null;
  // Once closed, a connection a later use opens isn't kept: it ends when that use is done.
  let closed = false;

  /**
   * Stops keeping a connection, so the next use opens another.
   *
   * @param kept - The connection.
   */
  const forget = (kept: Kept) => {
    if (current === kept) {
      current = null;
    }
  };

  /**
   * Once nothing uses a connection: ends it at once when its keeper is
   * closed, else after the idle time. The timer never keeps the process
   * running.
   *
   * @param kept - The connection.
   * @param connection - It, open.
   */
  const endWhenUnused = (kept: Kept, connection: Connection) => {
    if (kept.uses > 0) {
      return;
    }
    if (kept.closing) {
      connection.end();
      return;
    }
    const idle = setTimeout(() => {
      forget(kept);
      connection.end();
    }, keepMs);
    idle.unref();
    /* eslint-disable no-param-reassign -- The keeper's own record of its timer. */
    kept.idle = idle;
    kept.idleSince = Date.now();
    /* eslint-enable no-param-reassign */
  };

  /**
   * Takes the connection for a use.
   *
   * @returns The use.
   */
  const lease = async (): Promise<Lease> => {
    let kept = current;
    if (kept !== null && kept.idleSince !== null && Date.now() - kept.idleSince > keepMs) {
      // Idle longer than it should have stayed: its timer was held up (the process was frozen),
      // and the server or the network may have dropped it meanwhile. Not used again.
      const stale = kept;
      forget(stale);
      if (stale.idle) {
        clearTimeout(stale.idle);
      }
      stale.opening.then(
        (connection) => connection.end(),
        () => {},
      );
      kept = null;
    }
    if (kept === null) {
      const made: Kept = {
        opening: open(),
        uses: 0,
        idle: null,
        closing: closed,
        served: false,
        idleSince: null,
      };
      made.opening.then(
        (connection) => connection.onClose(() => forget(made)),
        () => forget(made),
      );
      current = made;
      kept = made;
    }
    const fresh = !kept.served;
    kept.uses += 1;
    kept.idleSince = null;
    if (kept.idle) {
      clearTimeout(kept.idle);
      kept.idle = null;
    }
    let connection: Connection;
    try {
      connection = await kept.opening;
    } catch (error) {
      kept.uses -= 1;
      throw error;
    }
    if (connection.closed) {
      // It ended while it was kept, before its end was noticed: open another.
      kept.uses -= 1;
      forget(kept);
      return lease();
    }
    const held = kept;
    let released = false;
    return {
      connection,
      fresh,
      /** Lets go of the connection; only the first call counts. */
      release: () => {
        if (released) {
          return;
        }
        released = true;
        held.served = true;
        held.uses -= 1;
        endWhenUnused(held, connection);
      },
      /** Stops keeping the connection, which ends once nothing uses it. */
      discard: () => {
        forget(held);
        held.closing = true;
        if (held.idle) {
          clearTimeout(held.idle);
          held.idle = null;
        }
        endWhenUnused(held, connection);
      },
    };
  };

  return {
    lease,
    /** Ends the connection once nothing uses it, and keeps none from now on. */
    close() {
      closed = true;
      const kept = current;
      current = null;
      if (!kept) {
        return;
      }
      kept.closing = true;
      if (kept.idle) {
        clearTimeout(kept.idle);
        kept.idle = null;
      }
      kept.opening.then(
        (connection) => endWhenUnused(kept, connection),
        () => {},
      );
    },
  };
}
