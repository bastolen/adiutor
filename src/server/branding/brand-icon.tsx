/**
 * @file The browser tab icon made from the brand (decision 0052): drawn from
 * the source `brandIconSource` picks (the own icon, a square logo, or the
 * staff's initials on the accent colour), at a browser tab's size and an
 * Apple touch icon's, and wrapped as an `.ico` for tools that ask for
 * `/favicon.ico`. Each version is drawn once per process: the public
 * routes that serve it never draw it again for the same brand, whatever
 * they're asked.
 */
import { createHash } from 'node:crypto';

import type { Database } from '@/db';
import {
  type BrandIconSize,
  type BrandIconSource,
  type BrandPalette,
  brandIconSource,
  derivePalette,
  fitInto,
} from '@/lib/branding';

import getStaffName from '../people/staff-name';
import { type BrandImages, loadBrandImage, loadBrandImages } from './brand-images';
import loadBrandColours from './colours';
import { drawPng, imageDataUrl } from './draw-image';

/** How the icon is drawn, and the version that changes whenever its look does. */
export interface BrandIconPlan {
  /** A short hash of everything the icon is drawn from: the version in its address. */
  version: string;
  /** What it's drawn from. */
  source: BrandIconSource;
  /** The image it's drawn from, for an own icon or a logo. */
  imageId: string | null;
  /** The accent behind the initials and the colour on it, from the light palette. */
  colours: { background: string; text: string };
}

/** A drawn icon and its version. */
export interface DrawnBrandIcon {
  /** The version it was drawn for. */
  version: string;
  /** The PNG. */
  png: Uint8Array;
}

/** The background of an Apple touch icon drawn from an image, which must be opaque. */
const TOUCH_ICON_BACKGROUND = '#ffffff';

/** The icons drawn so far, the latest per size. */
const drawnIcons = new Map<BrandIconSize, DrawnBrandIcon>();

/**
 * Works out how the icon is drawn from what was uploaded.
 *
 * @param images - The brand's uploaded images.
 * @param staffName - The staff's name, for its initials.
 * @param palette - The palette worked out from the brand colours.
 * @returns The plan, or `null` while it's Adiutor's own icon.
 */
export function planBrandIcon(
  images: BrandImages,
  staffName: string,
  palette: BrandPalette,
): BrandIconPlan | null {
  const source = brandIconSource(images, staffName);
  if (!source) {
    return null;
  }
  const imageId = source.kind === 'initials' ? null : (images[source.kind]?.id ?? null);
  const { light } = palette.palette;
  const colours = { background: light.primary, text: light['primary-foreground'] };
  const drawnFrom = source.kind === 'initials' ? [source, colours] : [source, imageId];
  const version = createHash('sha256')
    .update(JSON.stringify(drawnFrom))
    .digest('base64url')
    .slice(0, 16);
  return { version, source, imageId, colours };
}

/**
 * Draws the icon.
 *
 * @param plan - How it's drawn.
 * @param size - Its width and height.
 * @param image - The PNG it's drawn from, for an own icon or a logo.
 * @param image.content - The PNG's bytes.
 * @param image.width - Its width.
 * @param image.height - Its height.
 * @returns The PNG.
 */
export async function drawBrandIcon(
  plan: BrandIconPlan,
  size: BrandIconSize,
  image: { content: Uint8Array; width: number; height: number } | null,
): Promise<Uint8Array> {
  const touch = size === 180;
  const box = { display: 'flex', width: '100%', height: '100%' } as const;
  if (plan.source.kind === 'initials' || !image) {
    const letters = plan.source.kind === 'initials' ? plan.source.letters : '';
    return drawPng(
      <div
        style={{
          ...box,
          alignItems: 'center',
          justifyContent: 'center',
          background: plan.colours.background,
          color: plan.colours.text,
          // A tab shows the corners; iOS rounds a touch icon itself.
          borderRadius: touch ? 0 : size * 0.1875,
          fontSize: size * (letters.length > 1 ? 0.5 : 0.625),
          // The built-in font has one weight; a stroke in the text's colour makes it bolder.
          WebkitTextStroke: `${size * 0.025}px ${plan.colours.text}`,
        }}
      >
        {letters}
      </div>,
      { width: size, height: size },
    );
  }
  // A touch icon leaves a margin round the image, on an opaque background.
  const room = touch ? Math.round(size * 0.85) : size;
  const drawn = fitInto(image, { width: room, height: room }, { grow: true });
  return drawPng(
    <div
      style={{
        ...box,
        alignItems: 'center',
        justifyContent: 'center',
        background: touch ? TOUCH_ICON_BACKGROUND : 'transparent',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Drawn into a PNG by ImageResponse, never shown in a page. */}
      <img
        src={imageDataUrl(image.content, 'png')}
        width={drawn.width}
        height={drawn.height}
        alt=""
      />
    </div>,
    { width: size, height: size },
  );
}

/**
 * Loads how the icon is drawn: the uploaded images, the staff's name and the
 * brand colours.
 *
 * @param db - Database client.
 * @returns The plan, or `null` while it's Adiutor's own icon.
 */
export async function loadBrandIconPlan(db: Database): Promise<BrandIconPlan | null> {
  const [images, staffName, colours] = await Promise.all([
    loadBrandImages(db),
    getStaffName(db),
    loadBrandColours(db),
  ]);
  return planBrandIcon(images, staffName, derivePalette(colours));
}

/**
 * The icon as it is now, at one size: drawn once per version and kept.
 *
 * @param db - Database client.
 * @param size - Its width and height.
 * @returns The icon and its version, or `null` while it's Adiutor's own.
 */
export async function loadBrandIcon(
  db: Database,
  size: BrandIconSize,
): Promise<DrawnBrandIcon | null> {
  const plan = await loadBrandIconPlan(db);
  if (!plan) {
    return null;
  }
  const kept = drawnIcons.get(size);
  if (kept?.version === plan.version) {
    return kept;
  }
  const image = plan.source.kind === 'initials' ? null : await loadBrandImage(db, plan.source.kind);
  const icon = { version: plan.version, png: await drawBrandIcon(plan, size, image) };
  drawnIcons.set(size, icon);
  return icon;
}

/**
 * Wraps a PNG as an `.ico` file holding just it, which every browser and
 * tool that asks for `/favicon.ico` reads.
 *
 * @param png - The PNG.
 * @param size - Its width and height, at most 256.
 * @returns The `.ico` file.
 */
export function icoOf(png: Uint8Array, size: number): Uint8Array {
  const header = Buffer.alloc(22);
  // ICONDIR: reserved, type 1 (icon), one image.
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  // ICONDIRENTRY: width and height (0 means 256), no palette, one plane, 32 bits per pixel.
  header.writeUInt8(size >= 256 ? 0 : size, 6);
  header.writeUInt8(size >= 256 ? 0 : size, 7);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.byteLength, 14);
  header.writeUInt32LE(header.length, 18);
  return new Uint8Array(Buffer.concat([header, png]));
}
