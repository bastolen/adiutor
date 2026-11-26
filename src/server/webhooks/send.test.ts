/**
 * @file Tests for one attempt to send to a webhook, against a receiver on
 * 127.0.0.1: what's sent and signed, how each answer counts, that redirects
 * aren't followed and slow receivers are given up on, and that addresses
 * inside Adiutor's network are refused before anything connects.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startWebhookReceiver, type WebhookReceiver } from '../../../tests/http/webhook-receiver';
import { addressRules, RefusedAddressError, type ResolveAll } from './address-guard';
import { errorKind, sendWebhook } from './send';
import { newWebhookSecret, signWebhook } from './signing';

// The server's own allowed networks aren't used here: every send is given its rules.
vi.mock('@/lib/env', () => ({ env: { WEBHOOK_ALLOWED_NETWORKS: [], NODE_ENV: 'test' } }));

/** The receiver's loopback address is allowed, as the tests' environment allows it. */
const loopback = addressRules(['127.0.0.1/32']);

/**
 * Resolves every name to loopback, as a name an attacker points at the server itself would.
 *
 * @param _hostname - The name, whatever it is.
 * @param _options - The lookup's options.
 * @param callback - Called with 127.0.0.1.
 */
const toLoopback: ResolveAll = (_hostname, _options, callback) => {
  callback(null, [{ address: '127.0.0.1', family: 4 }]);
};

/**
 * Finds no address for any name, as for a host that doesn't exist.
 *
 * @param _hostname - The name, whatever it is.
 * @param _options - The lookup's options.
 * @param callback - Called with `ENOTFOUND`.
 */
const notFound: ResolveAll = (_hostname, _options, callback) => {
  callback(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }), []);
};

let receiver: WebhookReceiver;

beforeEach(async () => {
  receiver = await startWebhookReceiver();
});

afterEach(async () => {
  await receiver.close();
});

/**
 * A message to the receiver.
 *
 * @param overrides - What to change.
 * @returns The message.
 */
function message(overrides: Partial<Parameters<typeof sendWebhook>[0]> = {}) {
  return {
    url: receiver.url,
    secret: newWebhookSecret(),
    id: '019abcde-0000-7000-8000-000000000001',
    body: '{"type":"webhook.test"}',
    ...overrides,
  };
}

describe('sendWebhook', () => {
  it('posts the body as JSON, signed for that moment, and counts a 2xx as delivered', async () => {
    const sent = message();
    const now = new Date('2026-11-25T10:05:00Z');
    const result = await sendWebhook(sent, { rules: loopback, now });
    expect(result).toMatchObject({ delivered: true, status: 200 });
    const [request] = receiver.received;
    expect(request?.method).toBe('POST');
    expect(request?.path).toBe('/hook');
    expect(request?.body).toBe(sent.body);
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.headers['webhook-id']).toBe(sent.id);
    expect(request?.headers['webhook-timestamp']).toBe('1795601100');
    expect(request?.headers['webhook-signature']).toBe(
      signWebhook(sent.secret, { id: sent.id, timestamp: 1795601100, body: sent.body }),
    );
  });

  it('counts another status as a failure, keeping the status', async () => {
    receiver.answerWith({ status: 500, body: 'Internal error with details' });
    expect(await sendWebhook(message(), { rules: loopback })).toMatchObject({
      delivered: false,
      status: 500,
      error: 'http',
    });
    receiver.answerWith({ status: 410 });
    expect(await sendWebhook(message(), { rules: loopback })).toMatchObject({
      delivered: false,
      status: 410,
      error: 'http',
    });
  });

  it('never follows a redirect', async () => {
    receiver.answerWith({ status: 302, headers: { location: `${receiver.url}/elsewhere` } });
    expect(await sendWebhook(message(), { rules: loopback })).toMatchObject({
      delivered: false,
      status: 302,
      error: 'redirect',
    });
    expect(receiver.received).toHaveLength(1);
  });

  it('reads no more than a few kilobytes of a long answer', async () => {
    receiver.answerWith({ status: 200, body: 'x'.repeat(1024 * 1024) });
    expect(await sendWebhook(message(), { rules: loopback })).toMatchObject({
      delivered: true,
      status: 200,
    });
  });

  it('gives up on a receiver that doesn’t answer in time', async () => {
    receiver.answerWith({ hang: true });
    expect(await sendWebhook(message(), { rules: loopback, timeoutMs: 200 })).toMatchObject({
      delivered: false,
      status: null,
      error: 'timeout',
    });
  });

  it('refuses an address inside Adiutor’s network before connecting', async () => {
    expect(await sendWebhook(message(), { rules: addressRules([]) })).toMatchObject({
      delivered: false,
      error: 'refused_address',
    });
    expect(receiver.received).toHaveLength(0);
  });

  it('refuses a name that resolves inside Adiutor’s network, checking the address it connects to', async () => {
    const { port } = new URL(receiver.url);
    const url = `http://hooks.adiutor.test:${port}/hook`;
    expect(
      await sendWebhook(message({ url }), { rules: addressRules([]), resolve: toLoopback }),
    ).toMatchObject({ delivered: false, error: 'refused_address' });
    expect(receiver.received).toHaveLength(0);
    // The same name, with loopback allowed, reaches the receiver.
    expect(
      await sendWebhook(message({ url }), { rules: loopback, resolve: toLoopback }),
    ).toMatchObject({ delivered: true });
  });

  it('says when a name can’t be found or nothing listens', async () => {
    expect(
      await sendWebhook(message({ url: 'http://nowhere.adiutor.test/hook' }), {
        rules: loopback,
        resolve: notFound,
      }),
    ).toMatchObject({ delivered: false, error: 'dns' });
    const closed = receiver.url;
    await receiver.close();
    expect(await sendWebhook(message({ url: closed }), { rules: loopback })).toMatchObject({
      delivered: false,
      error: 'connection',
    });
    receiver = await startWebhookReceiver();
  });

  it('refuses an address that’s no longer acceptable, such as plain http in production', async () => {
    expect(
      await sendWebhook(message({ url: 'http://hooks.adiutor.dev/in' }), {
        rules: loopback,
        production: true,
      }),
    ).toMatchObject({ delivered: false, error: 'refused_address' });
  });
});

describe('errorKind', () => {
  it('names each kind of failure, a connection that didn’t open in time as a timeout', () => {
    /**
     * An error with a code, as Node.js gives its network errors.
     *
     * @param code - The code.
     * @returns The error.
     */
    const coded = (code: string) => Object.assign(new Error(code), { code });
    expect(errorKind(coded('ETIMEDOUT'))).toBe('timeout');
    expect(errorKind(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('timeout');
    expect(errorKind(coded('ENOTFOUND'))).toBe('dns');
    expect(errorKind(new RefusedAddressError())).toBe('refused_address');
    expect(errorKind(coded('CERT_HAS_EXPIRED'))).toBe('tls');
    expect(errorKind(coded('ERR_TLS_CERT_ALTNAME_INVALID'))).toBe('tls');
    expect(errorKind(coded('ECONNRESET'))).toBe('connection');
  });
});
