/**
 * @file What services need to run: a database, a way to send email, the
 * app's public URL and, during a request, who's making it and in which
 * language.
 *
 * Services receive this explicitly instead of importing globals, so tests can
 * run them against a test database and capture emails.
 */
import type { Database } from '@/db';
import type { Email } from '@/lib/email';
import type { Locale } from '@/lib/i18n/locales';
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
  /**
   * Reads the current request's language, for an email to the person making
   * the request (`requesterLocale`, e.g. an invite link's confirmation);
   * absent outside requests (tests, scripts, the hourly job), where Adiutor's
   * default language stands in.
   */
  requestLocale?: () => Promise<Locale>;
}
