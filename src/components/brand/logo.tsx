/**
 * @file The Adiutor logo, switching to the light-text version in dark mode.
 */
import Image from 'next/image';

/** Logo width-to-height ratio, from the SVG's viewBox. */
const ASPECT_RATIO = 416.09 / 95.5;

/**
 * Props for {@link Logo}.
 */
interface LogoProps {
  /** Height in pixels. Defaults to 40. */
  height?: number;
  /** Load it with high priority (for the first thing on the page). */
  priority?: boolean;
}

/**
 * The Adiutor logo. Decorative: wrap it in a link or heading with an
 * accessible name.
 *
 * @param props - Logo props.
 * @param props.height - Height in pixels.
 * @param props.priority - Load with high priority.
 * @returns Both logo versions; CSS shows the one for the current mode.
 */
export default function Logo({ height = 40, priority = false }: LogoProps) {
  const width = Math.round(height * ASPECT_RATIO);
  return (
    <>
      {/* The standard logo has dark text, so dark mode uses the light-text version. */}
      <Image
        src="/brand/logo.svg"
        alt=""
        width={width}
        height={height}
        priority={priority}
        className="dark:hidden"
      />
      <Image
        src="/brand/logo-on-dark.svg"
        alt=""
        width={width}
        height={height}
        priority={priority}
        className="hidden dark:block"
      />
    </>
  );
}
