/**
 * @file Initials in a rounded square, for people and companies.
 */
import cn from '@/lib/cn';

/**
 * Takes up to two initials from a name (or an email address).
 *
 * @param name - The name or email address.
 * @returns The initials, upper-cased.
 */
export function initialsOf(name: string): string {
  const words = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const [first = '?', second] = words;
  const letters = second === undefined ? first.slice(0, 2) : first.charAt(0) + second.charAt(0);
  return letters.toUpperCase();
}

/** Classes per avatar size. */
const sizeClasses = {
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
}

/**
 * An avatar with initials. Decorative: the name is always shown next to it.
 *
 * @param props - Avatar props.
 * @param props.name - The name.
 * @param props.size - Size.
 * @param props.brand - Use the brand colour.
 * @returns The avatar.
 */
export default function Avatar({ name, size = 'md', brand = false }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-semibold',
        brand ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        sizeClasses[size],
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
