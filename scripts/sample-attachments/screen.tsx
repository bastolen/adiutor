/**
 * @file How the sample screenshots are drawn (`screenshots.tsx`): as PNGs
 * with the `ImageResponse` Next.js ships (Satori and Resvg, as branding draws
 * its images), in a browser window with its tab and address bar, with the
 * pieces the pages share. Satori lays out with flexbox only, so every element
 * with more than one child says `display: flex`.
 */
import { ImageResponse } from 'next/og';
import type { ReactElement, ReactNode } from 'react';

/** The size of every screenshot: 4:3, as the file tiles crop their thumbnails. */
const SCREENSHOT = { width: 1200, height: 900 };

/** The colours the screenshots are drawn with. */
export const INK = {
  /** Body text. */
  text: '#1f2933',
  /** Secondary text. */
  muted: '#616e7c',
  /** Lines and borders. */
  line: '#d9dde3',
  /** Light backgrounds. */
  wash: '#f5f7fa',
  /** Errors. */
  danger: '#b42318',
  /** Error backgrounds. */
  dangerWash: '#fef3f2',
  /** Alpha's brand colour, on its shop and site. */
  alpha: '#1d4e89',
  /** Beta's brand colour. */
  beta: '#0f766e',
};

/**
 * Draws a screenshot as a PNG.
 *
 * @param element - What it shows.
 * @returns The PNG's bytes.
 */
export async function drawScreenshot(element: ReactElement): Promise<Uint8Array<ArrayBuffer>> {
  const response = new ImageResponse(element, SCREENSHOT);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * A browser window around a page, as a screenshot of one shows it: its tab
 * and its address bar above the page.
 *
 * @param props - The window.
 * @param props.title - The tab's title.
 * @param props.url - The page's address.
 * @param props.children - The page.
 * @returns The window.
 */
export function BrowserWindow({
  title,
  url,
  children,
}: {
  title: string;
  url: string;
  children: ReactNode;
}): ReactElement {
  /**
   * One of the window's three buttons.
   *
   * @param colour - Its colour.
   * @returns Its style.
   */
  const dot = (colour: string) => ({
    width: 13,
    height: 13,
    borderRadius: 7,
    background: colour,
  });
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        padding: 28,
        background: 'linear-gradient(135deg, #c9d3df, #e4e9f0)',
        fontSize: 18,
        color: INK.text,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          borderRadius: 12,
          overflow: 'hidden',
          background: '#ffffff',
          boxShadow: '0 16px 40px rgba(15, 23, 42, 0.22)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            height: 44,
            padding: '0 16px',
            background: '#e8ebef',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', height: 44, gap: 8 }}>
            <div style={dot('#ff5f57')} />
            <div style={dot('#febc2e')} />
            <div style={dot('#28c840')} />
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              width: 300,
              height: 34,
              marginLeft: 24,
              padding: '0 14px',
              borderRadius: '9px 9px 0 0',
              background: '#ffffff',
              fontSize: 14,
            }}
          >
            {title}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 46,
            padding: '0 16px',
            borderBottom: `1px solid ${INK.line}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexGrow: 1,
              height: 30,
              padding: '0 14px',
              borderRadius: 15,
              background: '#f1f3f5',
              fontSize: 14,
              color: INK.muted,
            }}
          >
            {url}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>{children}</div>
      </div>
    </div>
  );
}

/**
 * A website's header: its name and its menu.
 *
 * @param props - The header.
 * @param props.name - The site's name.
 * @param props.colour - Its brand colour.
 * @param props.links - Its menu.
 * @returns The header.
 */
export function SiteHeader({
  name,
  colour,
  links,
}: {
  name: string;
  colour: string;
  links: readonly string[];
}): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 72,
        padding: '0 48px',
        background: colour,
        color: '#ffffff',
      }}
    >
      <div style={{ display: 'flex', fontSize: 24, letterSpacing: -0.3 }}>{name}</div>
      <div style={{ display: 'flex', gap: 28, fontSize: 16 }}>
        {links.map((link) => (
          <div key={link} style={{ display: 'flex' }}>
            {link}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Two texts on one line, at its ends.
 *
 * @param props - The line.
 * @param props.left - The text on the left.
 * @param props.right - The text on the right.
 * @param props.strong - Whether it's the line that sums the others up.
 * @returns The line.
 */
export function SplitLine({
  left,
  right,
  strong,
}: {
  left: string;
  right: string;
  strong: boolean;
}): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderTop: strong ? `1px solid ${INK.line}` : 'none',
        fontSize: strong ? 20 : 17,
        color: strong ? INK.text : INK.muted,
      }}
    >
      <div style={{ display: 'flex' }}>{left}</div>
      <div style={{ display: 'flex' }}>{right}</div>
    </div>
  );
}
