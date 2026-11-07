/**
 * @file Health check at `/api/health`, for load balancers, container
 * platforms (the Docker image's `HEALTHCHECK`) and uptime monitors. Public, so
 * it works signed out (`PUBLIC_PATHS` in `src/proxy.ts`), and it says only
 * whether the app is healthy: `200 {"status":"ok"}` when the database answers
 * and has every migration applied, `503 {"status":"unavailable"}` otherwise
 * (see `src/server/health.ts`). Never cached.
 */
import { connection } from 'next/server';

import { db } from '@/db';
import { isHealthy } from '@/server/health';

/**
 * Reports whether the app is healthy.
 *
 * @returns The status, as JSON.
 */
export async function GET(): Promise<Response> {
  // Always at request time: a status from the build would say nothing.
  await connection();
  const healthy = await isHealthy(db);
  return Response.json(
    { status: healthy ? 'ok' : 'unavailable' },
    { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
