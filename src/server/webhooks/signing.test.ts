/**
 * @file Tests for signing what's sent to a webhook, against the Standard
 * Webhooks specification's own example, and for new secrets.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { newWebhookSecret, signedHeaders, signWebhook, WEBHOOK_SECRET_PREFIX } from './signing';

describe('signWebhook', () => {
  it('signs as the Standard Webhooks specification’s example does', () => {
    expect(
      signWebhook('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', {
        id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
        timestamp: 1614265330,
        body: '{"test": 2432232314}',
      }),
    ).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
  });

  it('gives another signature for another body, moment or delivery', () => {
    const secret = newWebhookSecret();
    const message = { id: 'a', timestamp: 1, body: '{}' };
    const signature = signWebhook(secret, message);
    expect(signWebhook(secret, { ...message, body: '{ }' })).not.toBe(signature);
    expect(signWebhook(secret, { ...message, timestamp: 2 })).not.toBe(signature);
    expect(signWebhook(secret, { ...message, id: 'b' })).not.toBe(signature);
  });
});

describe('signedHeaders', () => {
  it('names the delivery, the moment and the signature', () => {
    const secret = newWebhookSecret();
    const message = { id: 'delivery-1', timestamp: 1795600000, body: '{"type":"webhook.test"}' };
    expect(signedHeaders(secret, message)).toEqual({
      'webhook-id': 'delivery-1',
      'webhook-timestamp': '1795600000',
      'webhook-signature': signWebhook(secret, message),
    });
  });
});

describe('newWebhookSecret', () => {
  it('makes a different secret of 32 random bytes each time', () => {
    const secret = newWebhookSecret();
    expect(secret.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    expect(Buffer.from(secret.slice(WEBHOOK_SECRET_PREFIX.length), 'base64')).toHaveLength(32);
    expect(newWebhookSecret()).not.toBe(secret);
  });
});
