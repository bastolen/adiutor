/**
 * @file Attaching files to a text while it's written (decision 0044): an
 * "Attach files" button, files dropped on the form, and files or a
 * screenshot pasted into it. Each file is checked in the browser (its kind,
 * its size, how many), uploaded at once with its progress shown, and sent
 * with the text as an `attachment` field holding its ID; the file itself
 * never rides along with the form. An image shows the uploader's own copy,
 * and a video a frame drawn here, which the server then takes as its
 * preview (decision 0057). Its text comes from `requests.attachments`
 * (through `ClientMessages`).
 */
'use client';

import { Paperclip, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';

import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import FileTile from '@/components/ui/file-tile';
import { useTransientState } from '@/components/ui/use-transient-state';
import cn from '@/lib/cn';
import { formatFileSize } from '@/lib/format';
import {
  ATTACHMENT_ACCEPT,
  attachmentTypeOf,
  cleanAttachmentName,
  MAX_ATTACHMENTS_PER_TEXT,
  UPLOADS_AT_ONCE,
} from '@/lib/requests';
import { maxFileBytes } from '@/lib/storage';

import attachmentIcon from './attachment-icon';
import uploadAttachment from './upload-attachment';
import drawVideoFrame from './video-frame';

/** What a form needs to offer attaching: given only while people can attach files. */
export interface Attaching {
  /** The largest file, in megabytes. */
  maxFileMb: number;
}

/** A file waiting to be sent: uploading, or uploaded. */
interface WaitingFile {
  /** Its key in the list. */
  key: string;
  /** Its name. */
  name: string;
  /** Its size in bytes. */
  size: number;
  /** Whether its upload has started; at most `UPLOADS_AT_ONCE` run at a time. */
  started: boolean;
  /** How far its upload is, from 0 to 1. */
  progress: number;
  /** Its ID once it's uploaded, which the form sends. */
  id: string | null;
  /** A `blob:` address of an image, or of a video's frame, for its thumbnail. */
  preview: string | null;
  /** Whether it's a video, whose thumbnail carries a play mark. */
  video: boolean;
  /** Stops its upload. */
  stop: AbortController;
}

/**
 * Whether a paste or a drop carries files.
 *
 * @param data - What's pasted or dropped.
 * @returns Whether it holds files.
 */
function carriesFiles(data: DataTransfer | null): data is DataTransfer {
  return data !== null && [...data.types].includes('Files');
}

/**
 * The files to attach, with the button that adds them, and the files that
 * are uploading or uploaded below it. Put it in a form, above its buttons:
 * it listens to the form for dropped and pasted files (a paste that also
 * holds text, such as a copy from a document, stays a paste of the text),
 * and empties itself when the form is reset (after it was sent). While a
 * file uploads it says to wait, and tells the form (`onUploadingChange`),
 * whose submit buttons then wait too. A refused file is said in an `Alert`,
 * also as a toast outside a dialog; a file that's ready or removed is said
 * to screen readers. Removing a waiting file stops its upload, and focus
 * goes to the Attach button.
 *
 * @param props - Picker props.
 * @param props.maxFileMb - The largest file, in megabytes.
 * @param props.attached - How many files the text has already (one that's edited), which count
 *   towards the most it may have.
 * @param props.onUploadingChange - Told whether a file is uploading.
 */
export default function AttachmentPicker({
  maxFileMb,
  attached = 0,
  onUploadingChange = undefined,
}: {
  maxFileMb: number;
  attached?: number;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const t = useTranslations('requests.attachments');
  const locale = useLocale();
  const [files, setFiles] = useState<WaitingFile[]>([]);
  const [refusal, setRefusal] = useTransientState('');
  const [said, setSaid] = useTransientState('');
  const [dropping, setDropping] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const attachButton = useRef<HTMLButtonElement>(null);
  // The files as they are now, for the form's listeners and the uploads that finish later.
  const current = useRef(files);
  useLayoutEffect(() => {
    current.current = files;
  }, [files]);
  const uploading = files.some((file) => file.id === null);

  useEffect(() => {
    onUploadingChange?.(uploading);
  }, [uploading, onUploadingChange]);

  /**
   * Updates one waiting file, if it's still waiting.
   *
   * @param key - Its key.
   * @param change - What changes.
   */
  const update = (key: string, change: Partial<WaitingFile>) => {
    setFiles((waiting) =>
      waiting.map((file) => (file.key === key ? { ...file, ...change } : file)),
    );
  };

  /**
   * Takes a file off the list, stopping its upload and letting its thumbnail go.
   *
   * @param key - Its key.
   */
  const drop = (key: string) => {
    const file = current.current.find((candidate) => candidate.key === key);
    if (file) {
      file.stop.abort();
      if (file.preview) {
        URL.revokeObjectURL(file.preview);
      }
    }
    setFiles((waiting) => waiting.filter((candidate) => candidate.key !== key));
  };

  // Set when a failed upload's tile goes: if it had focus, focus goes to the Attach button.
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (refocus.current) {
      refocus.current = false;
      if (!document.activeElement || document.activeElement === document.body) {
        attachButton.current?.focus();
      }
    }
  }, [files]);

  // The files waiting for their upload to start, oldest first, and how many uploads run now.
  const queue = useRef<
    {
      key: string;
      name: string;
      file: File;
      stop: AbortController;
      frame: Promise<Blob | null> | null;
    }[]
  >([]);
  const running = useRef(0);

  /**
   * Starts the next waiting uploads, so that at most `UPLOADS_AT_ONCE` run
   * at a time (the server takes no more from one person); each that ends
   * starts the next. A file removed while it waited is skipped.
   */
  const startUploads = () => {
    while (running.current < UPLOADS_AT_ONCE && queue.current.length > 0) {
      const next = queue.current.shift();
      if (next && !next.stop.signal.aborted) {
        const { key, name, file, stop, frame } = next;
        running.current += 1;
        update(key, { started: true });
        uploadAttachment(file, {
          /**
           * Shows how far the upload is.
           *
           * @param progress - From 0 to 1.
           */
          onProgress: (progress) => update(key, { progress }),
          signal: stop.signal,
        })
          .then(
            (outcome) => {
              if (outcome.ok) {
                const { id } = outcome.file;
                /** Marks the file uploaded, so the form can send it, unless it was taken off. */
                const ready = () => {
                  if (stop.signal.aborted) {
                    return;
                  }
                  update(key, { id, name: outcome.file.name, progress: 1 });
                  setSaid(t('ready', { name: outcome.file.name }));
                };
                if (!frame) {
                  ready();
                  return;
                }
                // A video counts as uploaded once its frame went too: the server takes it only
                // while no text has the video yet. A frame that isn't taken changes nothing.
                void frame
                  .then(async (drawn) => {
                    if (drawn && !stop.signal.aborted) {
                      const form = new FormData();
                      form.set('attachment', id);
                      form.set('frame', drawn, 'frame.jpg');
                      // Loaded when a frame is sent: no form that holds the picker loads it before.
                      const { videoFrameAction } = await import('./video-frame-actions');
                      await videoFrameAction(form);
                    }
                  })
                  .catch(() => {})
                  .finally(ready);
                return;
              }
              if (outcome.stopped) {
                return;
              }
              refocus.current = true;
              drop(key);
              setRefusal(outcome.reason ?? t('failed', { name }));
            },
            () => {},
          )
          .finally(() => {
            running.current -= 1;
            startUploads();
          });
      }
    }
  };

  /**
   * Checks files and starts uploading the ones that may be attached. What
   * can't be is said, the first such file only.
   *
   * @param chosen - The files, as chosen, dropped or pasted.
   */
  const add = (chosen: readonly File[]) => {
    let refused = '';
    const room = MAX_ATTACHMENTS_PER_TEXT - attached - current.current.length;
    const started: WaitingFile[] = [];
    chosen.forEach((file, index) => {
      const name = cleanAttachmentName(file.name) ?? file.name;
      const type = attachmentTypeOf(name);
      let reason = '';
      if (index >= room) {
        reason = t('tooMany', { maximum: MAX_ATTACHMENTS_PER_TEXT });
      } else if (!type) {
        reason = t('typeNotAllowed', { name });
      } else if (file.size === 0) {
        reason = t('empty', { name });
      } else if (file.size > maxFileBytes(maxFileMb)) {
        reason = t('tooLarge', { name, maximum: maxFileMb });
      }
      if (reason) {
        refused ||= reason;
        return;
      }
      const waiting: WaitingFile = {
        key: crypto.randomUUID(),
        name,
        size: file.size,
        started: false,
        progress: 0,
        id: null,
        preview: type?.preview === 'image' ? URL.createObjectURL(file) : null,
        video: type?.preview === 'video',
        stop: new AbortController(),
      };
      // A video's frame is drawn while it uploads, and shown once it's there.
      const frame = waiting.video ? drawVideoFrame(file) : null;
      void frame?.then((drawn) => {
        if (drawn && !waiting.stop.signal.aborted) {
          update(waiting.key, { preview: URL.createObjectURL(drawn) });
        }
      });
      started.push(waiting);
      queue.current.push({ key: waiting.key, name, file, stop: waiting.stop, frame });
    });
    setRefusal(refused);
    if (started.length > 0) {
      setFiles((waiting) => [...waiting, ...started]);
      startUploads();
    }
  };
  // For the form's listeners, which are added once: `add` as it is when files come.
  const addFiles = useEffectEvent((chosen: readonly File[]) => add(chosen));

  useEffect(() => {
    const form = area.current?.closest('form');
    if (!form) {
      return undefined;
    }
    /** Empties the list once the form is reset (after it was sent). */
    const clear = () => {
      queue.current = [];
      current.current.forEach((file) => {
        // Also keeps a video's frame that comes later from showing.
        file.stop.abort();
        if (file.preview) {
          URL.revokeObjectURL(file.preview);
        }
      });
      setFiles([]);
    };
    /**
     * Attaches pasted files, unless the paste holds text too. Before the
     * editor sees it, so it doesn't paste the file as well.
     *
     * @param event - The paste.
     */
    const paste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!carriesFiles(data) || data.files.length === 0 || data.getData('text/plain') !== '') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      addFiles([...data.files]);
    };
    /**
     * Lets files be dropped on the form, and shows where.
     *
     * @param event - The drag over the form.
     */
    const dragOver = (event: DragEvent) => {
      if (carriesFiles(event.dataTransfer)) {
        event.preventDefault();
        setDropping(true);
      }
    };
    /**
     * Stops showing where to drop once the drag leaves the form.
     *
     * @param event - The drag leaving an element of the form.
     */
    const dragLeave = (event: DragEvent) => {
      if (!(event.relatedTarget instanceof Node) || !form.contains(event.relatedTarget)) {
        setDropping(false);
      }
    };
    /**
     * Attaches dropped files. Before the editor sees them, so it doesn't
     * take them as well.
     *
     * @param event - The drop.
     */
    const dropped = (event: DragEvent) => {
      setDropping(false);
      if (!carriesFiles(event.dataTransfer) || event.dataTransfer.files.length === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      addFiles([...event.dataTransfer.files]);
    };
    form.addEventListener('reset', clear);
    form.addEventListener('paste', paste, { capture: true });
    form.addEventListener('dragover', dragOver, { capture: true });
    form.addEventListener('dragleave', dragLeave);
    form.addEventListener('drop', dropped, { capture: true });
    return () => {
      form.removeEventListener('reset', clear);
      form.removeEventListener('paste', paste, { capture: true });
      form.removeEventListener('dragover', dragOver, { capture: true });
      form.removeEventListener('dragleave', dragLeave);
      form.removeEventListener('drop', dropped, { capture: true });
    };
  }, []);

  return (
    <div
      ref={area}
      className={cn(
        'flex flex-col gap-3 rounded-lg',
        dropping && 'outline-2 outline-offset-4 outline-primary outline-dashed',
      )}
    >
      <Alert tone="error" alsoToast onDismiss={() => setRefusal('')}>
        {refusal}
      </Alert>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          ref={attachButton}
          variant="secondary"
          size="sm"
          onClick={() => chooser.current?.click()}
        >
          <Paperclip aria-hidden="true" />
          {t('attach')}
        </Button>
        <input
          ref={chooser}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          hidden
          onChange={(event) => {
            add([...(event.target.files ?? [])]);
            // Chosen again, the same file is a new one.
            // eslint-disable-next-line no-param-reassign -- Emptying the chooser is how a file input is reset.
            event.target.value = '';
          }}
        />
        <p className="text-xs text-muted-foreground">
          {dropping
            ? t('dropHere')
            : t('hint', { count: MAX_ATTACHMENTS_PER_TEXT - attached, maximum: maxFileMb })}
        </p>
      </div>
      {files.length > 0 && (
        <ul
          aria-label={t('waiting', { count: files.length })}
          className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2"
        >
          {files.map((file) => {
            const Icon = attachmentIcon(file.name);
            return (
              <li key={file.key}>
                <FileTile
                  name={file.name}
                  detail={
                    // eslint-disable-next-line no-nested-ternary -- three states of one line: waiting, uploading, uploaded
                    file.id !== null
                      ? formatFileSize(file.size, locale)
                      : file.started
                        ? t('uploading', { progress: file.progress })
                        : t('queued')
                  }
                  icon={<Icon aria-hidden="true" />}
                  thumbnail={file.preview ?? undefined}
                  playMark={file.video}
                  actions={
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={t('remove', { name: file.name })}
                      className="px-1.5"
                      onClick={() => {
                        drop(file.key);
                        setSaid(t('removed', { name: file.name }));
                        attachButton.current?.focus();
                      }}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  }
                >
                  {file.id === null && (
                    <progress
                      max={1}
                      value={file.progress}
                      aria-label={t('uploadingLabel', { name: file.name })}
                      className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
                    />
                  )}
                </FileTile>
                {file.id !== null && <input type="hidden" name="attachment" value={file.id} />}
              </li>
            );
          })}
        </ul>
      )}
      {uploading && <p className="text-xs text-muted-foreground">{t('waitForUploads')}</p>}
      <p role="status" className="sr-only">
        {said}
      </p>
    </div>
  );
}
