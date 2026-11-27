/**
 * @file Where attached files are kept (decision 0044, "Attachments" in
 * `docs/deploying.md`): a folder on the server's disk, an S3-compatible
 * bucket or a folder over SFTP, behind one interface (`FileStorage`), chosen by
 * the server's environment or on the Integrations tab of Settings. Files are
 * kept under keys made from their IDs only. This folder's public API; free of `server-only`,
 * since the jobs' command imports it too.
 */
export { activeStorage, storageFor } from './active';
export { STORAGE_FAILURES, StorageError, type StorageFailure } from './errors';
export { attachmentKey, checkKey, previewKey } from './keys';
export { openStorage, sealStorage } from './secrets';
export {
  type AttachmentEnvironment,
  type AttachmentSettings,
  attachmentLimitMb,
  getAttachmentSettings,
  saveAttachmentLimit,
  saveAttachmentsEnabled,
  saveAttachmentStorage,
  setUpStorage,
} from './settings';
export { hostKeyFingerprint } from './sftp';
export type { FileStorage, StoredFile } from './types';
