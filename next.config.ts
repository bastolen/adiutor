/**
 * @file Next.js configuration for Adiutor.
 *
 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js
 */
import type { NextConfig } from 'next';

/**
 * The Content Security Policy for the static files the proxy skips (logos and
 * icons, see the matcher in `src/proxy.ts`): no scripts at all, even in an
 * SVG opened directly.
 */
const STATIC_FILE_POLICY =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

/**
 * Security headers sent with every response. The Content Security Policy for
 * pages isn't here: it needs a fresh nonce per request, so the proxy sets it
 * (`src/proxy.ts`, `src/lib/request/csp.ts`).
 */
const securityHeaders = [
  /** Never shown inside another site's frame (clickjacking); `frame-ancestors` for older browsers. */
  { key: 'X-Frame-Options', value: 'DENY' },
  /** Files are only used as the type the server says. */
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  /** Other sites see only the origin, never paths (invite links carry tokens). */
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  /** Browser features the app doesn't use are off; passkeys work on this site only. */
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), publickey-credentials-get=(self), publickey-credentials-create=(self)',
  },
  /** HTTPS only for two years, subdomains included (browsers ignore it over plain HTTP). */
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

/**
 * Project-wide Next.js settings.
 */
const nextConfig: NextConfig = {
  /** Don't announce the framework in an `X-Powered-By` header. */
  poweredByHeader: false,

  /**
   * Adds the security headers to every response, and a fixed Content
   * Security Policy to the static files the proxy skips.
   *
   * @returns The header rules.
   */
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The static files the proxy doesn't handle: nothing in them may run.
      ...['/brand/:path*', '/icon.svg'].map((source) => ({
        source,
        headers: [{ key: 'Content-Security-Policy', value: STATIC_FILE_POLICY }],
      })),
    ];
  },

  /** Enables Cache Components (part of the create-next-app defaults). */
  cacheComponents: true,

  /** Enables Partial Prefetching (part of the create-next-app defaults). */
  partialPrefetching: true,

  experimental: {
    /**
     * In development, Next.js checks every navigation for instant loading in
     * the background, rendering each page again in a worker. That makes a
     * breakpoint in a Server Component stop many times per page load, so the
     * server's debug configurations in `.vscode/launch.json` set
     * `SKIP_INSTANT_VALIDATION` to only check pages that ask for it
     * (`'manual-warning'`). Everywhere else this is Next's default
     * (`'warning'`). See "Debugging in VS Code" in docs/development.md.
     */
    instantInsights: {
      validationLevel: process.env.SKIP_INSTANT_VALIDATION ? 'manual-warning' : 'warning',
    },
  },

  /** Options passed to the Sass compiler for `.scss` files. */
  sassOptions: {
    /**
     * Folders Sass searches for `@use` imports, so any `.scss` file can write
     * `@use "brand"` instead of a relative path to `src/styles/_brand.scss`.
     */
    loadPaths: ['src/styles'],
  },

  /** Turbopack settings for the dev server and build. */
  turbopack: {
    rules: {
      /**
       * Runs Tailwind CSS on stylesheets.
       *
       * Limited to plain global CSS: re-typing CSS Modules or compiled Sass
       * output as `*.css` strips their scoped class names, so `.module.*`,
       * `.scss` and `.sass` files are skipped.
       */
      '*.css': {
        condition: { not: { path: /\.module\.|\.s[ac]ss/ } },
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
