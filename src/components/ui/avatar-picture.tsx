/**
 * @file The picture inside an avatar, which takes itself away when it can't
 * load, so the initials behind it show instead.
 */
'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A person's picture over an avatar's initials. When it fails to load (the
 * provider is down, the picture was changed, the address no longer serves
 * one), it's removed, and the initials it covered show. A picture that
 * failed before the page could react (while it was still loading its
 * scripts) is caught too, once the page can. A new address gets a new
 * chance: give the component a `key` with it.
 *
 * Decorative (`alt=""`): the name stands next to the avatar, or in its
 * title.
 *
 * @param props - Component props.
 * @param props.src - The picture's address (`/avatars/<account>`).
 * @returns The picture, or nothing once it failed.
 */
export default function AvatarPicture({ src }: { src: string }) {
  const picture = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const shown = picture.current;
    // Done loading without any pixels: it failed before this component could hear about it.
    if (shown?.complete && shown.naturalWidth === 0) {
      setFailed(true);
    }
  }, []);

  if (failed) {
    return null;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Served by Adiutor's own route, which needs the viewer's session: Next's image optimizer fetches without it.
    <img
      ref={picture}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="absolute inset-0 size-full object-cover"
    />
  );
}
