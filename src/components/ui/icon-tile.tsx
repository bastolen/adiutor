/**
 * @file A decorative icon on a tinted square, above a message or on a tile:
 * the result of an emailed link or invitation, an empty list, the dashboard's
 * shortcuts.
 */
import type { LucideIcon } from 'lucide-react';

import cn from '@/lib/cn';

/** The tile's colours. */
export type IconTileTone = 'muted' | 'success' | 'primary';

/** The tile's size: `md` (40px) beside or inside other content, `lg` (44px) above a page's message. */
export type IconTileSize = 'md' | 'lg';

/** Background and icon colour per tone, from the semantic tokens. */
const toneClasses: Record<IconTileTone, string> = {
  muted: 'bg-muted text-muted-foreground',
  success: 'bg-success-soft text-success',
  primary: 'bg-primary text-primary-foreground',
};

/** Size and corner radius per size. */
const sizeClasses: Record<IconTileSize, string> = {
  md: 'size-10 rounded-lg',
  lg: 'size-11 rounded-xl',
};

/**
 * Props for {@link IconTile}.
 */
interface IconTileProps {
  /** The icon, hidden from assistive technology. */
  icon: LucideIcon;
  /** Its colours. Defaults to `muted`. */
  tone?: IconTileTone;
  /** Its size. Defaults to `md`. */
  size?: IconTileSize;
}

/**
 * A 20px icon centred on a tinted square. It's decorative: the text next to
 * it says what it means.
 */
export default function IconTile({ icon: Icon, tone = 'muted', size = 'md' }: IconTileProps) {
  return (
    <span className={cn('flex items-center justify-center', sizeClasses[size], toneClasses[tone])}>
      <Icon aria-hidden="true" className="size-5" />
    </span>
  );
}
