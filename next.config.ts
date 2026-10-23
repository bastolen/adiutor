/**
 * @file Next.js configuration for Adiutor.
 *
 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js
 */
import type { NextConfig } from 'next';

/**
 * Project-wide Next.js settings.
 */
const nextConfig: NextConfig = {
  /** Enables Cache Components (part of the create-next-app defaults). */
  cacheComponents: true,

  /** Enables Partial Prefetching (part of the create-next-app defaults). */
  partialPrefetching: true,

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
