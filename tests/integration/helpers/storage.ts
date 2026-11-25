/**
 * @file The storages the integration tests reach: the S3-compatible server
 * from `compose.yaml` (SeaweedFS), with its test-only keys and bucket.
 */
import type { S3StorageConfig } from '@/lib/storage';

/** The test bucket on the compose S3 server, which `pnpm services:up` (and CI) creates. */
export const TEST_BUCKET: S3StorageConfig = {
  driver: 's3',
  endpoint: 'http://127.0.0.1:8333',
  region: 'us-east-1',
  bucket: 'adiutor-test',
  accessKeyId: 'adiutor',
  secretAccessKey: 'adiutor-test-secret',
  forcePathStyle: true,
};
