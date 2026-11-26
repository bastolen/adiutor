/**
 * @file Initials in a rounded square, for people and companies, or a
 * person's picture over them.
 */
import cn from '@/lib/cn';
import initialsOf from '@/lib/initials';

import AvatarPicture from './avatar-picture';

/** Classes per avatar size. */
const sizeClasses = {
  xs: 'size-6 text-[0.625rem]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
} as const;

/**
 * Props for {@link Avatar}.
 */
interface AvatarProps {
  /** Name (or email) to take the initials from. */
  name: string;
  /** Size. Defaults to `md`. */
  size?: keyof typeof sizeClasses;
  /** Use the brand colour instead of a neutral one. */
  brand?: boolean;
  /**
   * The name to show on hover, for an avatar that stands without its name
   * (several in a row); the name then also has to be there as text for
   * screen readers, since the avatar itself is hidden from them.
   */
  title?: string;
  /** Extra classes, e.g. the ring that sets avatars in a row apart. */
  className?: string;
  /**
   * A person's picture (`/avatars/<account>`), drawn over the initials, which
   * show whenever it can't load.
   */
  src?: string | null;
}

/**
 * An avatar with initials, or a person's picture over them. Decorative: the
 * name is shown next to it, or (in a row of avatars) on hover and as text
 * for screen readers. A picture that can't load takes itself away
 * (`AvatarPicture`), so the initials behind it show.
 */
export default function Avatar({
  name,
  size = 'md',
  brand = false,
  title = undefined,
  className = '',
  src = null,
}: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      title={title}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg font-semibold',
        brand ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        sizeClasses[size],
        className,
      )}
    >
      {initialsOf(name)}
      {src && <AvatarPicture key={src} src={src} />}
    </span>
  );
}
