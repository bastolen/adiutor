/**
 * @file A webhook receiver for the tests: a small HTTP server on 127.0.0.1
 * that keeps every request it gets (method, headers, body) and answers as a
 * test tells it to (a status, a delay, a redirect, a large answer, or no
 * answer at all). Loopback is inside Adiutor's own network, so the tests
 * allow `127.0.0.1/32` (their `WEBHOOK_ALLOWED_NETWORKS`, or rules given to
 * the send).
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One request the receiver got. */
export interface ReceivedRequest {
  /** Its method. */
  method: string;
  /** Its path, with the query. */
  path: string;
  /** Its headers, as Node.js gives them (lower case). */
  headers: IncomingHttpHeaders;
  /** Its body, as text. */
  body: string;
}

/** How the receiver answers. */
export interface ReceiverAnswer {
  /** The status; 200 unless set. */
  status?: number;
  /** Headers to answer with, e.g. a `location` for a redirect. */
  headers?: Record<string, string>;
  /** The body; empty unless set. */
  body?: string;
  /** How long to wait before answering, in milliseconds. */
  delayMs?: number;
  /** Never answer (until the server closes). */
  hang?: boolean;
}

/** A running receiver. */
export interface WebhookReceiver {
  /** Its address, `http://127.0.0.1:<port>/hook`. */
  url: string;
  /** Every request it got, in order. */
  received: ReceivedRequest[];
  /** Sets how it answers from now on. */
  answerWith: (answer: ReceiverAnswer) => void;
  /** Stops it. */
  close: () => Promise<void>;
}

/**
 * Starts a receiver on a free port of 127.0.0.1.
 *
 * @returns The receiver.
 */
export async function startWebhookReceiver(): Promise<WebhookReceiver> {
  const received: ReceivedRequest[] = [];
  let answer: ReceiverAnswer = {};
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const { status = 200, headers = {}, body = '', delayMs = 0, hang = false } = answer;
      if (hang) {
        return;
      }
      setTimeout(() => {
        response.writeHead(status, headers);
        response.end(body);
      }, delayMs);
    });
  });
  await new Promise<void>((started) => {
    server.listen(0, '127.0.0.1', started);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    /**
     * Sets how the receiver answers from now on.
     *
     * @param next - The answer.
     */
    answerWith: (next) => {
      answer = next;
    },
    /**
     * Stops the receiver, dropping any connection it keeps waiting.
     *
     * @returns When it has stopped.
     */
    close: () =>
      new Promise((closed) => {
        server.closeAllConnections();
        server.close(() => closed());
      }),
  };
}
