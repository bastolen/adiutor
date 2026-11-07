/**
 * @file Counts down the wait before another emailed code may be asked for
 * (`EMAIL_CODE_RESEND_SECONDS`), for the forms' "Send a new code" button. The
 * auth guards enforce the wait; this only shows it.
 */
'use client';

import { useEffect, useState } from 'react';

import { EMAIL_CODE_RESEND_SECONDS } from '@/lib/authz/mfa';

/** The countdown: how long is left, and a way to start it. */
export interface ResendCooldown {
  /** Seconds until a new code may be asked for; 0 once it may. */
  waitSeconds: number;
  /** Starts the wait, e.g. once a code was sent. */
  start: () => void;
  /** Ends it, e.g. once a code was used (the guards end their wait then too). */
  reset: () => void;
}

/**
 * Counts down from `EMAIL_CODE_RESEND_SECONDS` once started, ticking every
 * second while it runs and not at all otherwise.
 *
 * @returns The countdown.
 */
export default function useResendCooldown(): ResendCooldown {
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (readyAt === null) {
      return undefined;
    }
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= readyAt) {
        setReadyAt(null);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [readyAt]);

  return {
    waitSeconds: readyAt === null ? 0 : Math.max(0, Math.ceil((readyAt - now) / 1000)),
    /** Starts the wait from now. */
    start: () => {
      const current = Date.now();
      setNow(current);
      setReadyAt(current + EMAIL_CODE_RESEND_SECONDS * 1000);
    },
    /**
     * Ends the wait.
     *
     * @returns Nothing.
     */
    reset: () => setReadyAt(null),
  };
}
