/**
 * @file Where attached files are kept (decision 0044, "Attachments" in
 * `docs/deploying.md`): a folder on the server's disk or an S3-compatible
 * bucket, behind one interface (`FileStorage`). Files are kept under keys
 * made from their IDs only. This folder's public API; free of `server-only`,
 * since the jobs' command imports it too.
 */
export { activeStorage, storageFor } from './active';
export { STORAGE_FAILURES, StorageError, type StorageFailure } from './errors';
export { attachmentKey, checkKey } from './keys';
export type { FileStorage, StoredFile } from './types';
