/**
 * @file Where Adiutor keeps the files people attach (decision 0044): the
 * drivers an operator picks from, the settings each one takes, how the
 * server's environment chooses one, and the rules a storage must meet
 * before it's used. Free of zod and server code, so the environment's
 * schema, the services and the pages all import it.
 */
import isLocalHostname from './local-host';

/** The drivers: a folder on the server's disk, and an S3-compatible bucket. */
export const STORAGE_DRIVERS = ['local', 's3'] as const;

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

/** A storage's settings: a driver and what it needs. */
export type StorageConfig = LocalStorageConfig | S3StorageConfig;

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
 * - `relative_folder`: a folder must be an absolute path, so it doesn't
 *   depend on where the server was started.
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
  if (config.driver === 'local') {
    if (vercel) {
      problems.push('local_on_vercel');
    }
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
  const {
    ATTACHMENTS_S3_ENDPOINT: endpoint,
    ATTACHMENTS_S3_BUCKET: bucket,
    ATTACHMENTS_S3_ACCESS_KEY_ID: accessKeyId,
    ATTACHMENTS_S3_SECRET_ACCESS_KEY: secretAccessKey,
  } = environment;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    const required = {
      ATTACHMENTS_S3_ENDPOINT: endpoint,
      ATTACHMENTS_S3_BUCKET: bucket,
      ATTACHMENTS_S3_ACCESS_KEY_ID: accessKeyId,
      ATTACHMENTS_S3_SECRET_ACCESS_KEY: secretAccessKey,
    } as const;
    return {
      state: 'incomplete',
      missing: (Object.keys(required) as (keyof typeof required)[]).filter((key) => !required[key]),
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
