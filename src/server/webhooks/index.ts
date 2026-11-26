/**
 * @file Webhooks: where Adiutor sends what happens to requests, as signed JSON
 * or a chat message. This is the module's public API; the files next to it
 * are its internals: managing webhooks (`manage.ts`), delivering news to
 * them (`deliver.ts`), the guard that keeps them out of Adiutor's own
 * network (`address-guard.ts`), the JSON body and the chat message
 * (`formats.ts`), the signature (`signing.ts`) and one attempt to send
 * (`send.ts`).
 */
export {
  addressRules,
  type AddressRules,
  isRefusedAddress,
  pointsInside,
  serverAddressRules,
} from './address-guard';
export { attemptDelivery, deliverWebhookNews, type QueuedWebhookJob } from './deliver';
export {
  addWebhook,
  getWebhook,
  listWebhooks,
  removeWebhook,
  renewWebhookSecret,
  setWebhookOn,
  updateWebhook,
  type WebhookInput,
  type WebhookView,
} from './manage';
export { newWebhookSecret, signWebhook, WEBHOOK_SECRET_PREFIX } from './signing';
export {
  type SendOptions,
  sendWebhook,
  WEBHOOK_TIMEOUT_MS,
  type WebhookMessage,
  type WebhookSendResult,
} from './send';
