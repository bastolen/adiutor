/**
 * @file Where Adiutor keeps the files people attach (decision 0044): the
 * drivers an operator picks from, the settings each one takes, how the
 * server's environment chooses one, and the rules a storage must meet
 * before it's used. Free of zod and server code, so the environment's
 * schema, the services and the pages all import it.
 */
import isLocalHostname from './local-host';

/** The drivers: a folder on the server's disk, an S3-compatible bucket, and a folder over SFTP. */
export const STORAGE_DRIVERS = ['local', 's3', 'sftp'] as const;

/** One of {@link STORAGE_DRIVERS}. */
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

/** Files in a folder on the server's own disk. */
export interface LocalStorageConfig {
  driver: 'local';
  /** The folder, as an absolute path (e.g. `/data/attachments`, a volume in Docker). */
  dir: string;
}

/**
 * Files in a bucket of any S3-compatible service: AWS S3, Cloudflare R2,
 * Backblaze B2, or a server of your own such as Garage or SeaweedFS.
 */
export interface S3StorageConfig {
  driver: 's3';
  /** The service's address, e.g. `https://<account>.r2.cloudflarestorage.com`. */
  endpoint: string;
  /** The region the requests are signed for (`auto` on R2; `us-east-1` when the service has none). */
  region: string;
  /** The bucket's name. */
  bucket: string;
  /** The access key's ID. */
  accessKeyId: string;
  /** The access key's secret. */
  secretAccessKey: string;
  /**
   * Whether the bucket goes in the path (`endpoint/bucket/key`) rather than
   * the host name (`bucket.endpoint/key`), as most servers of your own need.
   */
  forcePathStyle: boolean;
}

/** Files in a folder on another server, over SFTP. */
export interface SftpStorageConfig {
  driver: 'sftp';
  /** The server's host name or address. */
  host: string;
  /** Its SSH port. */
  port: number;
  /** The user to sign in as. */
  username: string;
  /** The user's password, when it signs in with one. */
  password?: string;
  /** The user's private key (PEM), when it signs in with one. */
  privateKey?: string;
  /**
   * The server's host key, as `ssh-keygen -lf` prints its fingerprint
   * (`SHA256:` and 43 characters): a connection to any other key is refused.
   */
  hostKey: string;
  /** The folder on the server, as an absolute path. */
  dir: string;
}

/** A storage's settings: a driver and what it needs. */
export type StorageConfig = LocalStorageConfig | S3StorageConfig | SftpStorageConfig;

/** The SSH port, when none is given. */
export const DEFAULT_SFTP_PORT = 22;

/** A host key's fingerprint as OpenSSH prints it: SHA-256, in base64 without padding. */
export const HOST_KEY_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;

/** The region requests are signed for when none is given: what most services without regions accept. */
export const DEFAULT_S3_REGION = 'us-east-1';

/** The largest file anyone may attach unless a smaller limit is chosen, in megabytes. */
export const DEFAULT_MAX_FILE_MB = 10;

/**
 * The most the limit may be, in megabytes. Each upload is held in memory
 * while it's checked, so this keeps one upload's share of a small server's
 * memory modest.
 */
export const MAX_FILE_MB = 50;

/**
 * The most the limit may be on Vercel, in megabytes: Vercel refuses a
 * function a request body above 4.5 MB, and an upload goes through one.
 */
export const VERCEL_MAX_FILE_MB = 4;

/**
 * The largest limit a server may choose.
 *
 * @param vercel - Whether it runs on Vercel.
 * @returns The limit's ceiling, in megabytes.
 */
export function maxFileMbCeiling(vercel: boolean): number {
  return vercel ? VERCEL_MAX_FILE_MB : MAX_FILE_MB;
}

/**
 * What can make a storage unfit for where it runs:
 * - `local_on_vercel`: Vercel's disk doesn't keep files between requests.
 * - `relative_folder`: a folder (on this server or over SFTP) must be an
 *   absolute path, so it doesn't depend on where the server was started.
 * - `insecure_endpoint`: in production, an S3 endpoint must be `https`
 *   (the keys sign every request, and the files travel with them), except
 *   on this computer.
 */
export type StorageProblem = 'local_on_vercel' | 'relative_folder' | 'insecure_endpoint';

/** Where a storage would run, for {@link storageProblems}. */
export interface StorageSurroundings {
  /** Whether it's a production server (`NODE_ENV=production`). */
  production: boolean;
  /** Whether it runs on Vercel. */
  vercel: boolean;
}

/**
 * Whether a path is absolute: from the root (`/data/attachments`), or a
 * Windows drive (`C:\attachments`). Without `node:path`, so it runs anywhere.
 *
 * @param path - The path.
 * @returns Whether it's absolute.
 */
function isAbsolutePath(path: string): boolean {
  return /^(\/|[A-Za-z]:[\\/])/.test(path);
}

/**
 * The rules a storage must meet before it's used, the same for the server's
 * environment and for Settings.
 *
 * @param config - The storage's settings.
 * @param surroundings - Where it would run.
 * @returns What's wrong with it, or nothing.
 */
export function storageProblems(
  config: StorageConfig,
  surroundings: StorageSurroundings,
): StorageProblem[] {
  const { production, vercel } = surroundings;
  const problems: StorageProblem[] = [];
  if (config.driver === 'local' && vercel) {
    problems.push('local_on_vercel');
  }
  if (config.driver !== 's3') {
    if (!isAbsolutePath(config.dir)) {
      problems.push('relative_folder');
    }
  } else if (production && URL.canParse(config.endpoint)) {
    const { protocol, hostname } = new URL(config.endpoint);
    if (protocol !== 'https:' && !isLocalHostname(hostname)) {
      problems.push('insecure_endpoint');
    }
  }
  return problems;
}

/** The environment variables that choose a storage, as the environment's schema reads them. */
export interface StorageEnvironment {
  ATTACHMENTS_STORAGE?: 'off' | StorageDriver;
  ATTACHMENTS_DIR?: string;
  ATTACHMENTS_S3_ENDPOINT?: string;
  ATTACHMENTS_S3_REGION?: string;
  ATTACHMENTS_S3_BUCKET?: string;
  ATTACHMENTS_S3_ACCESS_KEY_ID?: string;
  ATTACHMENTS_S3_SECRET_ACCESS_KEY?: string;
  ATTACHMENTS_S3_FORCE_PATH_STYLE?: 'true' | 'false';
  ATTACHMENTS_SFTP_HOST?: string;
  ATTACHMENTS_SFTP_PORT?: number;
  ATTACHMENTS_SFTP_USERNAME?: string;
  ATTACHMENTS_SFTP_PASSWORD?: string;
  /** Base64, so the key fits on one line in `.env`, `docker --env-file` and Vercel. */
  ATTACHMENTS_SFTP_PRIVATE_KEY?: string;
  ATTACHMENTS_SFTP_HOST_KEY?: string;
  ATTACHMENTS_SFTP_DIR?: string;
}

/**
 * The names of those of `values` that aren't set.
 *
 * @param values - Required values, by their variable's name.
 * @returns The names of the missing ones.
 */
function missingOf<K extends keyof StorageEnvironment>(values: Record<K, string | undefined>): K[] {
  return (Object.keys(values) as K[]).filter((key) => !values[key]);
}

/**
 * Decodes a private key given in base64.
 *
 * @param encoded - The key in base64, if set.
 * @returns The key, or `undefined` when it isn't set or isn't base64 (which
 *   the environment's schema reports on its own).
 */
function decodedKey(encoded: string | undefined): string | undefined {
  if (!encoded) {
    return undefined;
  }
  try {
    return atob(encoded);
  } catch {
    return undefined;
  }
}

/**
 * Reads an SFTP server the environment chooses.
 *
 * @param environment - The parsed environment.
 * @returns What it says about storage.
 */
function sftpFromEnvironment(environment: StorageEnvironment): EnvironmentStorage {
  const {
    ATTACHMENTS_SFTP_HOST: host,
    ATTACHMENTS_SFTP_USERNAME: username,
    ATTACHMENTS_SFTP_PASSWORD: password,
    ATTACHMENTS_SFTP_HOST_KEY: hostKey,
    ATTACHMENTS_SFTP_DIR: dir,
  } = environment;
  const privateKey = decodedKey(environment.ATTACHMENTS_SFTP_PRIVATE_KEY);
  const missing = missingOf({
    ATTACHMENTS_SFTP_HOST: host,
    ATTACHMENTS_SFTP_USERNAME: username,
    // One way to sign in is needed; the password stands for both when neither is set.
    ATTACHMENTS_SFTP_PASSWORD: password ?? privateKey,
    ATTACHMENTS_SFTP_HOST_KEY: hostKey,
    ATTACHMENTS_SFTP_DIR: dir,
  });
  if (!host || !username || !hostKey || !dir || missing.length > 0) {
    return { state: 'incomplete', missing };
  }
  return {
    state: 'set',
    config: {
      driver: 'sftp',
      host,
      port: environment.ATTACHMENTS_SFTP_PORT ?? DEFAULT_SFTP_PORT,
      username,
      ...(password ? { password } : {}),
      ...(privateKey ? { privateKey } : {}),
      hostKey,
      dir,
    },
  };
}

/**
 * What the server's environment says about storage:
 * - `unset`: nothing, so Settings decides;
 * - `off`: attachments are off, and Settings can't turn them on;
 * - `incomplete`: a driver without all it needs (the names of what's missing);
 * - `set`: a storage, which Settings can't change.
 */
export type EnvironmentStorage =
  | { state: 'unset' }
  | { state: 'off' }
  | { state: 'incomplete'; missing: (keyof StorageEnvironment)[] }
  | { state: 'set'; config: StorageConfig };

/**
 * Reads the storage the server's environment chooses.
 *
 * @param environment - The parsed environment.
 * @returns What it says about storage.
 */
export function storageFromEnvironment(environment: StorageEnvironment): EnvironmentStorage {
  const driver = environment.ATTACHMENTS_STORAGE;
  if (!driver) {
    return { state: 'unset' };
  }
  if (driver === 'off') {
    return { state: 'off' };
  }
  if (driver === 'local') {
    const dir = environment.ATTACHMENTS_DIR;
    return dir
      ? { state: 'set', config: { driver, dir } }
      : { state: 'incomplete', missing: ['ATTACHMENTS_DIR'] };
  }
  if (driver === 'sftp') {
    return sftpFromEnvironment(environment);
  }
  const {
    ATTACHMENTS_S3_ENDPOINT: endpoint,
    ATTACHMENTS_S3_BUCKET: bucket,
    ATTACHMENTS_S3_ACCESS_KEY_ID: accessKeyId,
    ATTACHMENTS_S3_SECRET_ACCESS_KEY: secretAccessKey,
  } = environment;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return {
      state: 'incomplete',
      missing: missingOf({
        ATTACHMENTS_S3_ENDPOINT: endpoint,
        ATTACHMENTS_S3_BUCKET: bucket,
        ATTACHMENTS_S3_ACCESS_KEY_ID: accessKeyId,
        ATTACHMENTS_S3_SECRET_ACCESS_KEY: secretAccessKey,
      }),
    };
  }
  return {
    state: 'set',
    config: {
      driver,
      endpoint,
      region: environment.ATTACHMENTS_S3_REGION ?? DEFAULT_S3_REGION,
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: environment.ATTACHMENTS_S3_FORCE_PATH_STYLE === 'true',
    },
  };
}

/** The longest a storage's text field may be (an address, a bucket, a folder, a key's ID or secret). */
export const STORAGE_FIELD_MAX_LENGTH = 1024;

/** The longest a private key may be, in its PEM text. */
export const PRIVATE_KEY_MAX_LENGTH = 16_384;

/**
 * What a page may show of a storage: its settings without any secret (the
 * S3 secret key, the SFTP password or private key). The Settings page shows
 * it, and the storage's form starts from it.
 */
export type StorageView =
  | LocalStorageConfig
  | Omit<S3StorageConfig, 'secretAccessKey'>
  | (Omit<SftpStorageConfig, 'password' | 'privateKey'> & {
      /** How it signs in: with a password or with a private key. */
      signsInWith: 'password' | 'key';
    });

/**
 * A storage's settings without its secrets, for a page.
 *
 * @param config - The settings.
 * @returns What a page may show.
 */
export function storageView(config: StorageConfig): StorageView {
  if (config.driver === 's3') {
    const { driver, endpoint, region, bucket, accessKeyId, forcePathStyle } = config;
    return { driver, endpoint, region, bucket, accessKeyId, forcePathStyle };
  }
  if (config.driver === 'sftp') {
    const { driver, host, port, username, hostKey, dir, privateKey } = config;
    return {
      driver,
      host,
      port,
      username,
      hostKey,
      dir,
      signsInWith: privateKey ? 'key' : 'password',
    };
  }
  return config;
}
