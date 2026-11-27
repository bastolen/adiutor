/**
 * @file Next.js configuration for Adiutor.
 *
 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js
 */
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { IMAGE_FILE_POLICY } from './src/lib/request/csp';

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
   * Hides Next.js's development indicator (the round "N"): in every corner it
   * covers one of the app's controls (the menu button on phones, the
   * sidebar's account button, the theme and language button). Compile and
   * runtime errors still show. Development only.
   */
  devIndicators: false,

  /**
   * Adds the security headers to every response, and a fixed Content
   * Security Policy to the static files the proxy skips.
   *
   * @returns The header rules.
   */
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The logos and icons the proxy doesn't handle: nothing in them may run, even in an SVG
      // opened directly.
      ...['/brand/:path*', '/favicon.ico'].map((source) => ({
        source,
        headers: [{ key: 'Content-Security-Policy', value: IMAGE_FILE_POLICY }],
      })),
    ];
  },

  /**
   * Sends `/favicon.ico` to the brand's icon (`src/app/branding/favicon/`),
   * which is Adiutor's own until a staff Admin uploads a logo or an icon
   * (decision 0052). The proxy skips the path, so tools that ask for it
   * without reading the page get the icon, signed in or not.
   *
   * @returns The rewrite rules.
   */
  async rewrites() {
    return [{ source: '/favicon.ico', destination: '/branding/favicon' }];
  },

  /**
   * Sends the addresses of Settings tabs that were merged into others to the
   * card that took the old tab's first place (decision 0055), so bookmarks,
   * emailed links and return addresses still land there. Temporary (307), so
   * browsers don't keep them: a later tab may take one of these addresses.
   * The query string comes along; an anchor on the old address gives way to
   * the card's.
   *
   * @returns The redirect rules.
   */
  async redirects() {
    return [
      { source: '/admin/settings/appearance', destination: '/admin/settings#logo' },
      { source: '/admin/settings/email', destination: '/admin/settings/integrations#mail-server' },
      {
        source: '/admin/settings/attachments',
        destination: '/admin/settings/integrations#storage',
      },
      // Only the list: a webhook's page keeps its address.
      { source: '/admin/settings/webhooks', destination: '/admin/settings/integrations#webhooks' },
    ].map((rule) => ({ ...rule, permanent: false }));
  },

  /** Enables Cache Components (part of the create-next-app defaults). */
  cacheComponents: true,

  /** Enables Partial Prefetching (part of the create-next-app defaults). */
  partialPrefetching: true,

  experimental: {
    /**
     * A server action's request may be up to 2 MB, past Next's 1 MB: room for
     * a logo or icon of up to 1 MB (`BRAND_IMAGE_MAX_MB`) with its form's
     * overhead. The proxy already reads bodies of up to 10 MB, so this opens
     * nothing new; each action checks its own input.
     */
    serverActions: { bodySizeLimit: '2mb' },

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

  /** Turbopack settings for the dev server and build. */
  turbopack: {
    rules: {
      /**
       * Runs Tailwind CSS on stylesheets.
       *
       * Limited to plain global CSS: re-typing CSS Modules as `*.css` strips
       * their scoped class names, so `.module.*` files are skipped.
       */
      '*.css': {
        condition: { not: { path: /\.module\./ } },
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

/**
 * Adds next-intl: points it at the per-request configuration (the
 * request's language and messages, see docs/i18n.md).
 */
const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

export default withNextIntl(nextConfig);
