/**
 * @file The request header the proxy uses to pass the requested path to
 * pages, which can't read their own URL on the server (used by the MFA
 * step-up to send users back where they were).
 */

/** Request header with the requested path and query, set by the proxy for the pages. */
const PATHNAME_HEADER = 'x-adiutor-pathname';

export default PATHNAME_HEADER;
