/**
 * @file The viewer of a request's files (decision 0058): every file the
 * reader can see on the page, in the page's order, opened from its tile and
 * stepped through with Previous and Next. Each kind shows what it can, from
 * the file's own address and its checks: an image as it is (a HEIC photo only
 * where the browser shows it), a PDF's first page drawn large, a text file's
 * start as text, a video playing (a part at a time, with its frame as the
 * poster), an Office file's thumbnail, and for anything else its icon, with
 * Download. Its text
 * comes from `requests.attachments`.
 */
'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  createContext,
  createElement,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useState,
} from 'react';

import FileViewer from '@/components/ui/file-viewer';
import { useTransientState } from '@/components/ui/use-transient-state';
import { formatFileSize } from '@/lib/format';
import { attachmentTypeOf } from '@/lib/requests';

import attachmentIcon from './attachment-icon';
import { readTextStart, type TextStart } from './attachment-text';

/** A file the viewer can open: what the page knows of it. */
export interface ViewableFile {
  /** Its ID, which its addresses hold. */
  id: string;
  /** Its name. */
  name: string;
  /** Its size in bytes. */
  size: number;
  /** Whether it has a preview. */
  preview: boolean;
}

/** What the viewer shows a file as. */
type ShownAs = 'image' | 'pdf' | 'text' | 'video' | 'thumbnail' | 'icon';

/**
 * What the viewer shows a file as, by its type.
 *
 * @param file - The file.
 * @returns How it's shown.
 */
function shownAs(file: ViewableFile): ShownAs {
  const type = attachmentTypeOf(file.name);
  if (type?.contentType.startsWith('image/')) {
    return 'image';
  }
  if (type?.preview === 'pdf') {
    return 'pdf';
  }
  if (type?.check === 'text') {
    return 'text';
  }
  if (type?.preview === 'video') {
    return 'video';
  }
  return file.preview ? 'thumbnail' : 'icon';
}

/**
 * The `id` of a file's open button on its tile, for focus to come back to.
 *
 * @param id - The file's ID.
 * @returns The button's `id`.
 */
export function openButtonId(id: string): string {
  return `attachment-open-${id}`;
}

/** Opens a file in the viewer, by its ID; `null` outside a viewer. */
const OpenFile = createContext<((id: string) => void) | null>(null);

/**
 * Opens a file in the page's viewer.
 *
 * @returns The opener, or `null` on a page without a viewer.
 */
export function useOpenFile(): ((id: string) => void) | null {
  return use(OpenFile);
}

/**
 * A file shown as its icon, for a file the viewer can't show.
 *
 * @param props - Panel props.
 * @param props.file - The file.
 * @param props.note - What to say under its icon.
 */
function IconPanel({ file, note }: { file: ViewableFile; note: string }) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 p-6 text-center">
      {createElement(attachmentIcon(file.name), {
        'aria-hidden': true,
        className: 'size-16 text-muted-foreground',
      })}
      <p className="text-sm text-muted-foreground">{note}</p>
    </div>
  );
}

/**
 * An image in the viewer, with a fallback when it can't be shown.
 *
 * @param props - Image props.
 * @param props.sources - The addresses to try in turn (the file, then its preview).
 * @param props.alt - Its alternative text.
 * @param props.fallback - What shows when none of them loads.
 * @param props.placeholder - What shows while the first loads (its preview).
 * @param props.fit - Whether it's enlarged to fit, or kept at its own size at most.
 */
function ViewerImage({
  sources,
  alt,
  fallback,
  placeholder = null,
  fit = true,
}: {
  sources: readonly string[];
  alt: string;
  fallback: ReactNode;
  placeholder?: string | null;
  fit?: boolean;
}) {
  const [tried, setTried] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const source = sources[tried];
  if (source === undefined) {
    return fallback;
  }
  return (
    <>
      {placeholder && !loaded && (
        // eslint-disable-next-line @next/next/no-img-element -- Served by Adiutor's own route, which needs the viewer's session.
        <img
          src={placeholder}
          alt=""
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain blur-sm"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- Served by Adiutor's own route, which needs the viewer's session. */}
      <img
        key={source}
        src={source}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          setTried((count) => count + 1);
        }}
        className={
          fit
            ? 'relative max-h-full max-w-full object-contain'
            : 'relative max-h-full max-w-full object-scale-down'
        }
      />
    </>
  );
}

/**
 * A text file's start, as text: read as a part of the file, shown in a box
 * that wraps its lines and scrolls (and takes focus, so the keyboard scrolls
 * it too), with a note when the file goes on.
 *
 * @param props - Text props.
 * @param props.file - The file.
 * @param props.fallback - What shows when it can't be read.
 */
function TextContent({ file, fallback }: { file: ViewableFile; fallback: ReactNode }) {
  const t = useTranslations('requests.attachments.viewer');
  const [start, setStart] = useState<TextStart | 'loading' | 'failed'>('loading');

  useEffect(() => {
    const reading = new AbortController();
    readTextStart(`/attachments/${file.id}`, file.size, reading.signal).then(setStart, () => {
      if (!reading.signal.aborted) {
        setStart('failed');
      }
    });
    return () => reading.abort();
  }, [file.id, file.size]);

  if (start === 'failed') {
    return fallback;
  }
  if (start === 'loading') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('textLoading')}
      </p>
    );
  }
  return (
    <div className="flex size-full min-h-0 flex-col gap-2 p-2">
      <pre
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A box that scrolls must take focus, so the keyboard can scroll it.
        tabIndex={0}
        aria-label={t('textLabel', { name: file.name })}
        className="min-h-0 flex-1 overflow-auto rounded-md bg-surface p-4 text-left font-mono text-sm wrap-anywhere whitespace-pre-wrap text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {start.text}
      </pre>
      {start.cut && <p className="text-xs text-muted-foreground">{t('textCut')}</p>}
    </div>
  );
}

/**
 * A video, playing in the viewer: the browser asks for it a part at a time
 * (`Range`), so it starts at once and seeks; its frame is the poster. A
 * video the browser can't play (an HEVC `.mov` in Chrome) gives way to the
 * fallback.
 *
 * @param props - Video props.
 * @param props.file - The file.
 * @param props.fallback - What shows when it can't play.
 */
function VideoContent({ file, fallback }: { file: ViewableFile; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const href = `/attachments/${file.id}`;
  if (failed) {
    return fallback;
  }
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- Screen recordings people attach come without captions to offer.
    <video
      controls
      preload="metadata"
      src={href}
      poster={file.preview ? `${href}/preview` : undefined}
      aria-label={file.name}
      onError={() => setFailed(true)}
      className="max-h-full max-w-full"
    />
  );
}

/**
 * The file itself, as the viewer shows its kind.
 *
 * @param props - Content props.
 * @param props.file - The file.
 */
function FileContent({ file }: { file: ViewableFile }) {
  const t = useTranslations('requests.attachments.viewer');
  const href = `/attachments/${file.id}`;
  const preview = file.preview ? `${href}/preview` : null;
  const icon = <IconPanel file={file} note={t('notShown')} />;
  switch (shownAs(file)) {
    case 'image':
      return <ViewerImage sources={[href]} alt={file.name} placeholder={preview} fallback={icon} />;
    case 'pdf':
      return (
        <div className="flex size-full min-h-0 flex-col items-center gap-2 p-2">
          <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
            <ViewerImage
              sources={preview ? [`${href}/page`, preview] : []}
              alt={file.name}
              fallback={icon}
            />
          </div>
          {preview && <p className="text-xs text-muted-foreground">{t('pdfFirstPage')}</p>}
        </div>
      );
    case 'text':
      return (
        <TextContent file={file} fallback={<IconPanel file={file} note={t('textFailed')} />} />
      );
    case 'video':
      return (
        <VideoContent file={file} fallback={<IconPanel file={file} note={t('videoFailed')} />} />
      );
    case 'thumbnail':
      return (
        <ViewerImage
          sources={preview ? [preview] : []}
          alt={file.name}
          fallback={icon}
          fit={false}
        />
      );
    default:
      return icon;
  }
}

/**
 * Gives the page's file tiles a viewer to open files in: the files the
 * reader can see, in the page's order, which Previous and Next step
 * through. Its open state is transient, so it's closed when someone comes
 * back to the page.
 *
 * @param props - Provider props.
 * @param props.files - The page's files, in its order, without removed ones.
 * @param props.children - The page.
 */
export default function AttachmentViewer({
  files,
  children,
}: {
  files: readonly ViewableFile[];
  children: ReactNode;
}) {
  const t = useTranslations('requests.attachments.viewer');
  const locale = useLocale();
  const [openId, setOpenId] = useTransientState<string | null>(null);
  // The file last shown, so the dialog keeps it while it closes.
  const [shownId, setShownId] = useState<string | null>(null);
  const index = files.findIndex((file) => file.id === openId);
  const shown = files.find((file) => file.id === (openId ?? shownId)) ?? null;

  /**
   * Opens a file.
   *
   * @param id - The file's ID.
   */
  const open = useCallback(
    (id: string) => {
      setOpenId(id);
      setShownId(id);
    },
    [setOpenId],
  );

  /**
   * The step to the file at an offset from the open one.
   *
   * @param offset - -1 for the one before, 1 for the one after.
   * @returns Its opener, or `null` past the ends.
   */
  const stepTo = (offset: number) => {
    const target = files[index + offset];
    return index >= 0 && target ? () => open(target.id) : null;
  };

  return (
    <OpenFile value={open}>
      {children}
      {shown && (
        <FileViewer
          open={index >= 0}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setOpenId(null);
            }
          }}
          name={shown.name}
          position={t('position', { position: index + 1, count: files.length })}
          previous={{ label: t('previous'), onStep: stepTo(-1) }}
          next={{ label: t('next'), onStep: stepTo(1) }}
          detail={formatFileSize(shown.size, locale)}
          download={{ href: `/attachments/${shown.id}`, label: t('download') }}
          finalFocus={() => {
            const tile = document.getElementById(openButtonId(shown.id));
            tile?.focus();
            return tile !== null;
          }}
        >
          <FileContent key={shown.id} file={shown} />
        </FileViewer>
      )}
    </OpenFile>
  );
}
