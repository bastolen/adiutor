/**
 * @file Root layout: the HTML shell shared by every page.
 */
import type { Metadata } from 'next';
import './globals.css';

/**
 * Default page metadata. Pages can override these values.
 */
export const metadata: Metadata = {
  title: 'Adiutor',
};

/**
 * Wraps every page in the `<html>` and `<body>` elements and loads the
 * global styles.
 *
 * @param props - Layout props from Next.js.
 * @param props.children - The page or nested layout to render.
 * @returns The document shell.
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
