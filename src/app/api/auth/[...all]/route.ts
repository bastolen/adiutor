/**
 * @file Serves Better Auth's HTTP API at `/api/auth/*` (sign-in, sign-out,
 * OAuth callbacks, magic links, password reset).
 */
import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';

/** Better Auth's handlers for GET and POST requests below `/api/auth`. */
export const { GET, POST } = toNextJsHandler(auth);
