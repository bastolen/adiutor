/**
 * @file What services need to run: a database, a way to send email, the
 * app's public URL and, during a request, who's making it.
 *
 * Services receive this explicitly instead of importing globals, so tests can
 * run them against a test database and capture emails.
 */
import type { Database } from '@/db';
import type { Email } from '@/lib/email';
import type { RequestInfo } from '@/lib/request/request-info';

/**
 * Dependencies passed to every service function.
 */
export interface ServiceContext {
  /** Database client. */
  db: Database;
  /** Sends an email. */
  sendEmail: (email: Email) => Promise<void>;
  /** Public base URL of the app, used in links (no trailing slash). */
  baseUrl: string;
  /** Reads where the current request came from; absent outside requests (tests, scripts). */
  requestInfo?: () => Promise<RequestInfo>;
}
