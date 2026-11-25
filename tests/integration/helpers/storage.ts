/**
 * @file The storages the integration tests reach: the S3-compatible server
 * (SeaweedFS) and the SFTP server (OpenSSH) from `compose.yaml`, with their
 * test-only keys and passwords.
 */
import { Client } from 'ssh2';

import type { S3StorageConfig, SftpStorageConfig } from '@/lib/storage';
import { hostKeyFingerprint } from '@/server/storage';

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

/** The compose SFTP server's sign-in, with its test-only password. */
const TEST_SFTP_SERVER = {
  host: '127.0.0.1',
  port: 2222,
  username: 'adiutor',
  password: 'adiutor-test-secret',
} as const;

/**
 * Settings for a folder of the test's own on the compose SFTP server: makes
 * the folder, and reads the host key ssh2 is given, which the server made
 * when it first started.
 *
 * @param dir - The folder, an absolute path under `/config` (the user's home).
 * @returns The settings, with the server's host key.
 */
export function testSftpFolder(dir: string): Promise<SftpStorageConfig> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let hostKey = '';
    client.on('error', reject);
    client.once('ready', () => {
      client.sftp((error, sftp) => {
        if (error) {
          client.end();
          reject(error);
          return;
        }
        sftp.mkdir(dir, (made) => {
          client.end();
          if (made) {
            reject(made);
          } else {
            resolve({ driver: 'sftp', ...TEST_SFTP_SERVER, hostKey, dir });
          }
        });
      });
    });
    client.connect({
      ...TEST_SFTP_SERVER,
      /**
       * Notes the server's host key.
       *
       * @param key - The key.
       * @returns Always true: this connection is how the tests learn it.
       */
      hostVerifier: (key: Buffer) => {
        hostKey = hostKeyFingerprint(key);
        return true;
      },
    });
  });
}
