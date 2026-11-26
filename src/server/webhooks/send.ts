/**
 * @file Sends one signed POST to a webhook and says how it went, never what
 * the receiver answered: its status, how long it took, or the kind of
 * failure (`WebhookErrorKind`). It connects only to addresses outside
 * Adiutor's own network (`address-guard.ts`, checked on this very
 * connection), follows no redirect, gives up after 10 seconds in all (the
 * look-up, the connection, the encryption and the answer's headers: a job's
 * piece of work must end well within the tick, `REQUEST_RUN_SECONDS`) and
 * after 3 when the connection doesn't open, reads at most 4 KB of the answer
 * and drops it, and goes through no proxy. It
 * logs nothing: the caller logs the delivery's ID and the kind of failure,
 * never the address, which can hold a token.
 */
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

import { env } from '@/lib/env';
import { type WebhookErrorKind, webhookUrlProblem } from '@/lib/webhooks';

import {
  type AddressRules,
  guardedLookup,
  isRefusedAddress,
  RefusedAddressError,
  type ResolveAll,
  serverAddressRules,
} from './address-guard';
import { signedHeaders } from './signing';

/** How long one attempt may take in all, in milliseconds. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * How long the connection may take to open, in milliseconds: a host that
 * drops packets gives up here rather than using the whole attempt.
 */
const CONNECT_TIMEOUT_MS = 3000;

/** The most of a receiver's answer that's read before the connection is closed. */
const MAX_ANSWER_BYTES = 4096;

/** One attempt to send. */
export interface WebhookMessage {
  /** The webhook's address. */
  url: string;
  /** Its signing secret. */
  secret: string;
  /** The delivery's ID (`webhook-id`), the same on every attempt. */
  id: string;
  /** The JSON body. */
  body: string;
}

/** How an attempt went. */
export type WebhookSendResult =
  | {
      /** The receiver took it: a 2xx status. */
      delivered: true;
      /** The status it answered with. */
      status: number;
      /** How long it took, in milliseconds. */
      durationMs: number;
    }
  | {
      /** It wasn't delivered. */
      delivered: false;
      /** The status the receiver answered with, if it answered. */
      status: number | null;
      /** Why not. */
      error: WebhookErrorKind;
      /** How long it took, in milliseconds. */
      durationMs: number;
    };

/** What an attempt may be given instead of the server's own settings, for tests. */
export interface SendOptions {
  /** The allowed networks; the server's own (`WEBHOOK_ALLOWED_NETWORKS`) otherwise. */
  rules?: AddressRules;
  /** How names are looked up; Node.js's own otherwise. */
  resolve?: ResolveAll;
  /** How long it may take, in milliseconds; {@link WEBHOOK_TIMEOUT_MS} otherwise. */
  timeoutMs?: number;
  /** How long the connection may take to open, in milliseconds; 3 seconds otherwise. */
  connectTimeoutMs?: number;
  /** Whether Adiutor runs in production, for the address's rules; from `NODE_ENV` otherwise. */
  production?: boolean;
  /** The moment it's sent, for `webhook-timestamp`; now otherwise. */
  now?: Date;
}

/** Node.js's codes for a certificate or encryption that can't be trusted, beyond the `ERR_TLS_`, `ERR_SSL_` and `CERT_` ones. */
const TLS_ERROR_CODES: ReadonlySet<string> = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'EPROTO',
]);

/** Node.js's codes for a host name that couldn't be found. */
const DNS_ERROR_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_FAIL',
  'EAI_NODATA',
  'EAI_NONAME',
]);

/**
 * The kind of failure an error from a request stands for.
 *
 * @param error - The request's error.
 * @returns The kind.
 */
export function errorKind(error: unknown): WebhookErrorKind {
  if (error instanceof RefusedAddressError) {
    return 'refused_address';
  }
  const { code = '', name } = error as NodeJS.ErrnoException;
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    code === 'ABORT_ERR' ||
    code === 'ETIMEDOUT'
  ) {
    return 'timeout';
  }
  if (DNS_ERROR_CODES.has(code)) {
    return 'dns';
  }
  if (
    TLS_ERROR_CODES.has(code) ||
    code.startsWith('ERR_TLS_') ||
    code.startsWith('ERR_SSL_') ||
    code.startsWith('CERT_')
  ) {
    return 'tls';
  }
  return 'connection';
}

/**
 * How an answer counts, from its status alone.
 *
 * @param status - The status the receiver answered with.
 * @param durationMs - How long it took.
 * @returns The result.
 */
function answered(status: number, durationMs: number): WebhookSendResult {
  if (status >= 200 && status < 300) {
    return { delivered: true, status, durationMs };
  }
  return {
    delivered: false,
    status,
    error: status >= 300 && status < 400 ? 'redirect' : 'http',
    durationMs,
  };
}

/**
 * Sends one attempt: a signed `POST` of the body, as JSON, to the webhook's
 * address, if it's still acceptable and outside Adiutor's network.
 *
 * @param message - The address, the secret, the delivery's ID and the body.
 * @param options - Settings for tests; the server's own otherwise.
 * @returns How it went.
 */
export function sendWebhook(
  message: WebhookMessage,
  options: SendOptions = {},
): Promise<WebhookSendResult> {
  const started = performance.now();
  /**
   * How long the attempt has taken so far.
   *
   * @returns The milliseconds since it started, rounded.
   */
  const elapsed = () => Math.round(performance.now() - started);
  const rules = options.rules ?? serverAddressRules();
  const production = options.production ?? env.NODE_ENV === 'production';
  if (webhookUrlProblem(message.url, { production }) !== null) {
    return Promise.resolve({
      delivered: false,
      status: null,
      error: 'refused_address',
      durationMs: 0,
    });
  }
  const url = new URL(message.url);
  // An address in the URL itself is never looked up, so the lookup's check doesn't see it.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(host) !== 0 && isRefusedAddress(host, rules)) {
    return Promise.resolve({
      delivered: false,
      status: null,
      error: 'refused_address',
      durationMs: 0,
    });
  }
  const timestamp = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const body = Buffer.from(message.body);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    let settled = false;
    /**
     * Gives the attempt's result, once: the answer, its end and an error can each come first.
     *
     * @param result - How it went.
     */
    const settle = (result: WebhookSendResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const request = send(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(body.length),
          'user-agent': 'Adiutor',
          ...signedHeaders(message.secret, {
            id: message.id,
            timestamp,
            body: message.body,
          }),
        },
        // A fresh agent: no connection kept for another request, and no proxy past the guard.
        agent: false,
        lookup: guardedLookup(rules, options.resolve),
        signal: AbortSignal.timeout(options.timeoutMs ?? WEBHOOK_TIMEOUT_MS),
      },
      (response: IncomingMessage) => {
        const result = answered(response.statusCode ?? 0, elapsed());
        let read = 0;
        response.on('data', (chunk: Buffer) => {
          read += chunk.length;
          if (read > MAX_ANSWER_BYTES) {
            response.destroy();
          }
        });
        response.on('end', () => settle(result));
        response.on('close', () => settle(result));
        response.on('error', () => settle(result));
      },
    );
    request.on('error', (error) => {
      settle({ delivered: false, status: null, error: errorKind(error), durationMs: elapsed() });
    });
    request.on('socket', (socket) => {
      if (!socket.connecting) {
        return;
      }
      const giveUp = setTimeout(() => {
        request.destroy(
          Object.assign(new Error('The connection didn’t open in time.'), { code: 'ETIMEDOUT' }),
        );
      }, options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
      socket.once('connect', () => clearTimeout(giveUp));
      socket.once('close', () => clearTimeout(giveUp));
    });
    request.end(body);
  });
}
