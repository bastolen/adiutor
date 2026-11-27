/**
 * @file A mail server's settings and their rules, shared by sending
 * (`src/lib/email.ts`), the services and the Connections tab of Settings: how a
 * connection is secured, what a page may show (never the password), what a
 * production server refuses, the mail server `SMTP_URL` names, and the
 * sender emails go out from. Pure: free of zod and server code, so client
 * components may import it.
 */
import isLocalHostname from './local-host';

/**
 * How a connection to the mail server is secured: TLS from the start
 * (`tls`, usually port 465), STARTTLS that must succeed (`starttls`, usually
 * port 587), or neither (`none`), which production allows only for a mail
 * server on this computer.
 */
export const SMTP_SECURITIES = ['tls', 'starttls', 'none'] as const;

/** How a connection to the mail server is secured ({@link SMTP_SECURITIES}). */
export type SmtpSecurity = (typeof SMTP_SECURITIES)[number];

/** The usual port for each kind of security, used when the form leaves the port empty. */
export const DEFAULT_SMTP_PORTS: Readonly<Record<SmtpSecurity, number>> = {
  tls: 465,
  starttls: 587,
  none: 25,
};

/** The longest host, username, password or sender name a mail server's form takes. */
export const SMTP_FIELD_MAX_LENGTH = 320;

/** Who emails come from: an address, and the name mail apps show with it. */
export interface Sender {
  /** The name shown with the address, e.g. "Adiutor"; `null` for the address alone. */
  name: string | null;
  /** The address, e.g. `no-reply@adiutor.dev`. */
  address: string;
}

/** The sender when neither `EMAIL_FROM` nor Settings names one. */
export const DEFAULT_SENDER: Sender = { name: 'Adiutor', address: 'no-reply@adiutor.dev' };

/** {@link DEFAULT_SENDER} as one line. */
export const DEFAULT_EMAIL_FROM = 'Adiutor <no-reply@adiutor.dev>';

/**
 * A mail server, as Settings keeps it and sending uses it. Where it's kept,
 * the password is encrypted (`sealSecret` in `src/server/`); sending gets it
 * decrypted.
 */
export interface SmtpConfig {
  /** The server's host name or address. */
  host: string;
  /** Its port. */
  port: number;
  /** How the connection is secured. */
  security: SmtpSecurity;
  /** Who to sign in as, or `null` for a server that takes email without signing in. */
  username: string | null;
  /** The password, or `null` without one. */
  password: string | null;
  /** Who emails come from, unless `EMAIL_FROM` says otherwise. */
  from: Sender;
}

/** A mail server as a page may show it: never the password, only whether there is one. */
export type SmtpView = Omit<SmtpConfig, 'password'> & {
  /** Whether a password is saved. */
  hasPassword: boolean;
};

/**
 * A mail server's settings without its password, for a page.
 *
 * @param config - The mail server.
 * @returns What a page may show.
 */
export function smtpView(config: SmtpConfig): SmtpView {
  const { password, ...rest } = config;
  return { ...rest, hasPassword: password !== null && password !== '' };
}

/**
 * The mail server `SMTP_URL` names, as the mail server card shows it: never its
 * password. `smtps://` is TLS, `smtp://` with `requireTLS=true` STARTTLS,
 * and any other `smtp://` neither; the port is nodemailer's default when the
 * URL has none.
 *
 * @param url - `SMTP_URL`.
 * @returns The mail server without a sender, or `null` when the URL can't be read.
 */
export function smtpUrlView(url: string): Omit<SmtpView, 'from'> | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  let security: SmtpSecurity = 'none';
  if (parsed.protocol === 'smtps:') {
    security = 'tls';
  } else if (parsed.searchParams.get('requireTLS') === 'true') {
    security = 'starttls';
  }
  return {
    host: parsed.hostname,
    port: parsed.port
      ? Number(parsed.port)
      : DEFAULT_SMTP_PORTS[security === 'tls' ? 'tls' : 'starttls'],
    security,
    username: parsed.username ? decodeURIComponent(parsed.username) : null,
    hasPassword: parsed.password !== '',
  };
}

/** Why a mail server can't be used where Adiutor runs. */
export type SmtpProblem = 'tlsRequired';

/**
 * What's wrong with a mail server where Adiutor runs: in production, a
 * connection must be secured unless the server is on this computer (as
 * `SMTP_URL` must, `isProductionSmtpUrl` in `env-schema.ts`).
 *
 * @param config - The mail server.
 * @param config.host - Its host.
 * @param config.security - How the connection is secured.
 * @param surroundings - Where Adiutor runs.
 * @param surroundings.production - Whether it's a production server.
 * @returns The problems, none when it can be used.
 */
export function smtpProblems(
  { host, security }: Pick<SmtpConfig, 'host' | 'security'>,
  { production }: { production: boolean },
): SmtpProblem[] {
  return production && security === 'none' && !isLocalHostname(host) ? ['tlsRequired'] : [];
}

/**
 * The kinds of failure a mail server's test names (`smtpFailureOf`), never
 * what the server replied: it couldn't be reached, didn't answer in time,
 * failed to secure the connection, refused the login, refused the sender or
 * recipient, or refused the email itself.
 */
export const SMTP_FAILURES = [
  'unreachable',
  'timedOut',
  'tls',
  'loginRefused',
  'addressRefused',
  'refused',
] as const;

/** A kind of failure of a mail server's test ({@link SMTP_FAILURES}). */
export type SmtpFailure = (typeof SMTP_FAILURES)[number];

/** Codes of a certificate the connection couldn't trust, from Node's TLS. */
const CERTIFICATE_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** Codes of a server that couldn't be reached, from nodemailer and from Node's network. */
const UNREACHABLE_CODES = new Set([
  'ECONNECTION',
  'EDNS',
  'EPROXY',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * The kind of a failed send, from its error's code alone (nodemailer's, or
 * Node's for the network and TLS), so the reply a server gave is never shown
 * or logged.
 *
 * @param error - What the send threw.
 * @returns The kind, or `null` for an error that isn't a mail server's (a bug).
 */
export function smtpFailureOf(error: unknown): SmtpFailure | null {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (typeof code !== 'string') {
    return null;
  }
  if (code === 'ETIMEDOUT') {
    return 'timedOut';
  }
  if (code === 'ETLS' || CERTIFICATE_CODES.has(code)) {
    return 'tls';
  }
  if (code === 'EAUTH' || code === 'ENOAUTH') {
    return 'loginRefused';
  }
  if (code === 'EENVELOPE') {
    return 'addressRefused';
  }
  if (code === 'EMESSAGE' || code === 'EPROTOCOL') {
    return 'refused';
  }
  if (code === 'ESOCKET') {
    // A socket error is most often a certificate the connection didn't trust, which nodemailer
    // wraps; only the kind is kept, never the text.
    return typeof message === 'string' && /certificate|ssl|tls/i.test(message)
      ? 'tls'
      : 'unreachable';
  }
  return UNREACHABLE_CODES.has(code) ? 'unreachable' : null;
}

/**
 * A sender as one line, the way a mail app shows it.
 *
 * @param sender - The sender.
 * @returns E.g. `Adiutor <no-reply@adiutor.dev>`, or the address alone without a name.
 */
export function senderText(sender: Sender): string {
  return sender.name ? `${sender.name} <${sender.address}>` : sender.address;
}
