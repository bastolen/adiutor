/**
 * @file Tests for attaching files while a text is written: files chosen,
 * dropped or pasted are checked in the browser, uploaded with their progress
 * shown, and sent with the form by their IDs; a refused one is said, a
 * removed one stops uploading, and a reset form starts empty.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import AttachmentPicker from './attachment-picker';
import uploadAttachment, { type UploadOutcome } from './upload-attachment';

vi.mock('./upload-attachment', () => ({ default: vi.fn() }));

/** An upload that's under way, which the test ends. */
interface PendingUpload {
  /** The file that's uploading. */
  file: File;
  /** Tells the picker how far it is. */
  progress: (share: number) => void;
  /** Ends it. */
  finish: (outcome: UploadOutcome) => void;
  /** Whether the picker stopped it. */
  stopped: () => boolean;
}

/** The uploads started, in order. */
let uploads: PendingUpload[];

beforeEach(() => {
  uploads = [];
  vi.mocked(uploadAttachment).mockImplementation(
    (file, { onProgress, signal }) =>
      new Promise((resolve) => {
        uploads.push({
          file,
          progress: onProgress,
          finish: resolve,
          /**
           * Whether the picker stopped the upload.
           *
           * @returns Whether it did.
           */
          stopped: () => signal.aborted,
        });
      }),
  );
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.mocked(uploadAttachment).mockReset();
});

/**
 * A text file.
 *
 * @param name - Its name.
 * @param text - What it says.
 * @returns The file.
 */
function textFile(name: string, text = 'printer offline'): File {
  return new File([text], name, { type: 'text/plain' });
}

/**
 * The picker in a form, as a form that sends a text has it.
 *
 * @returns The form, the hidden file chooser and what the form was told about uploading.
 */
function renderPicker() {
  const onUploadingChange = vi.fn();
  const { container } = render(
    <form aria-label="Reply">
      <AttachmentPicker maxFileMb={1} onUploadingChange={onUploadingChange} />
      <button type="reset">Reset</button>
    </form>,
  );
  const chooser = defined(
    container.querySelector<HTMLInputElement>('input[type="file"]'),
    'the file chooser',
  );
  return { form: screen.getByRole('form', { name: 'Reply' }), chooser, onUploadingChange };
}

/**
 * Chooses files, as the file chooser does.
 *
 * @param chooser - The hidden file input.
 * @param files - The files.
 */
function choose(chooser: HTMLInputElement, files: File[]): void {
  fireEvent.change(chooser, { target: { files } });
}

/**
 * What a paste or a drop holds, as the browser gives it.
 *
 * @param files - The files.
 * @param text - Text it holds too.
 * @returns The data.
 */
function transfer(files: File[], text = '') {
  return {
    types: ['Files', ...(text ? ['text/plain'] : [])],
    files,
    /**
     * Reads the text it holds.
     *
     * @returns The text, or nothing.
     */
    getData: () => text,
  };
}

describe('AttachmentPicker', () => {
  it('uploads a chosen file, shows how far it is, and sends its ID once it’s uploaded', async () => {
    const { form, chooser, onUploadingChange } = renderPicker();
    expect(
      screen.getByText('You can also drop or paste files: up to 10 of at most 1 MB each.'),
    ).toBeInTheDocument();

    choose(chooser, [textFile('printer.log')]);
    const waiting = await screen.findByRole('list', { name: '1 file to send' });
    const [upload] = uploads;
    act(() => defined(upload, 'the upload').progress(0.5));
    expect(within(waiting).getByText('Uploading, 50%')).toBeInTheDocument();
    expect(within(waiting).getByRole('progressbar', { name: 'Uploading printer.log' })).toHaveValue(
      0.5,
    );
    expect(screen.getByText('Wait until the files are uploaded to send.')).toBeInTheDocument();
    expect(onUploadingChange).toHaveBeenLastCalledWith(true);

    act(() =>
      defined(upload, 'the upload').finish({
        ok: true,
        file: { id: 'attachment-1', name: 'printer.log', size: 15 },
      }),
    );
    expect(await within(waiting).findByText('15 bytes')).toBeInTheDocument();
    expect(new FormData(form as HTMLFormElement).getAll('attachment')).toEqual(['attachment-1']);
    expect(screen.getByText('printer.log is ready to send.')).toBeInTheDocument();
    expect(onUploadingChange).toHaveBeenLastCalledWith(false);
  });

  it('refuses in the browser a kind it can’t attach, an empty file and a file too large', () => {
    const { chooser } = renderPicker();

    choose(chooser, [textFile('setup.exe')]);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'setup.exe can’t be attached. Attach images, PDFs, text, Office or OpenDocument files, archives or screen recordings.',
    );
    choose(chooser, [textFile('empty.log', '')]);
    expect(screen.getByRole('alert')).toHaveTextContent('empty.log is empty.');
    choose(chooser, [textFile('huge.log', 'x'.repeat(1024 * 1024 + 1))]);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'huge.log is too large: attach files of at most 1 MB.',
    );
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it('takes at most 10 files for a text, and says so', async () => {
    const { chooser } = renderPicker();
    choose(
      chooser,
      Array.from({ length: 11 }, (_, index) => textFile(`log-${index}.txt`)),
    );
    expect(await screen.findByRole('list', { name: '10 files to send' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Attach at most 10 files to one text.');
    // Three upload at a time; the rest wait their turn.
    expect(uploadAttachment).toHaveBeenCalledTimes(3);
  });

  it('uploads three files at a time, starting the next as one ends', async () => {
    const { chooser } = renderPicker();
    choose(chooser, [
      textFile('one.log'),
      textFile('two.log'),
      textFile('three.log'),
      textFile('four.log'),
    ]);
    const waiting = await screen.findByRole('list', { name: '4 files to send' });
    expect(uploads.map(({ file }) => file.name)).toEqual(['one.log', 'two.log', 'three.log']);
    expect(within(waiting).getByText('Waiting to upload')).toBeInTheDocument();

    act(() =>
      defined(uploads[0], 'the first upload').finish({
        ok: true,
        file: { id: 'attachment-1', name: 'one.log', size: 15 },
      }),
    );
    await waitFor(() => expect(uploads).toHaveLength(4));
    expect(uploads[3]?.file.name).toBe('four.log');
    expect(within(waiting).queryByText('Waiting to upload')).not.toBeInTheDocument();
  });

  it('never starts a waiting file that was removed', async () => {
    const user = userEvent.setup();
    const { chooser } = renderPicker();
    choose(
      chooser,
      ['one.log', 'two.log', 'three.log', 'four.log'].map((name) => textFile(name)),
    );
    const waiting = await screen.findByRole('list', { name: '4 files to send' });
    await user.click(within(waiting).getByRole('button', { name: 'Remove four.log' }));

    act(() =>
      defined(uploads[0], 'the first upload').finish({ ok: false, reason: null, stopped: true }),
    );
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(3));
    expect(uploads.map(({ file }) => file.name)).not.toContain('four.log');
  });

  it('says why Adiutor refused an upload, and takes the file off', async () => {
    const { chooser } = renderPicker();
    choose(chooser, [textFile('printer.log')]);
    await screen.findByRole('list', { name: '1 file to send' });

    act(() =>
      defined(uploads[0], 'the upload').finish({
        ok: false,
        reason: 'That file isn’t what its name says it is, so it can’t be attached.',
        stopped: false,
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That file isn’t what its name says it is, so it can’t be attached.',
    );
    expect(screen.queryByRole('list', { name: /to send$/ })).not.toBeInTheDocument();

    // Without a reason it didn't reach Adiutor, which the picker words itself.
    choose(chooser, [textFile('driver.log')]);
    await screen.findByRole('list', { name: '1 file to send' });
    act(() =>
      defined(uploads[1], 'the upload').finish({ ok: false, reason: null, stopped: false }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'driver.log couldn’t be uploaded. Try again.',
    );
  });

  it('stops a removed file’s upload and gives focus to the Attach button', async () => {
    const user = userEvent.setup();
    const { chooser } = renderPicker();
    choose(chooser, [new File(['png'], 'error.png', { type: 'image/png' })]);
    const waiting = await screen.findByRole('list', { name: '1 file to send' });
    // An image waiting to be sent shows as itself.
    expect(within(waiting).getByRole('presentation')).toHaveAttribute('src', 'blob:preview');

    await user.click(within(waiting).getByRole('button', { name: 'Remove error.png' }));

    expect(defined(uploads[0], 'the upload').stopped()).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    expect(screen.queryByRole('list', { name: /to send$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach files' })).toHaveFocus();
    expect(screen.getByText('error.png won’t be sent.')).toBeInTheDocument();
  });

  it('attaches pasted files, but leaves a paste that holds text to the field', async () => {
    const { form } = renderPicker();

    fireEvent.paste(form, { clipboardData: transfer([textFile('notes.txt')], 'From a document') });
    expect(uploadAttachment).not.toHaveBeenCalled();

    const pasted = fireEvent.paste(form, { clipboardData: transfer([textFile('notes.txt')]) });
    // Taken from the field, so the editor doesn't paste it too.
    expect(pasted).toBe(false);
    expect(await screen.findByRole('list', { name: '1 file to send' })).toBeInTheDocument();
  });

  it('attaches files dropped on the form, and says where to drop them meanwhile', async () => {
    const { form } = renderPicker();
    const dropped = transfer([textFile('notes.txt')]);

    fireEvent.dragOver(form, { dataTransfer: dropped });
    expect(screen.getByText('Drop the files to attach them.')).toBeInTheDocument();
    fireEvent.drop(form, { dataTransfer: dropped });

    expect(await screen.findByRole('list', { name: '1 file to send' })).toBeInTheDocument();
    expect(screen.queryByText('Drop the files to attach them.')).not.toBeInTheDocument();
  });

  it('starts empty again when the form is reset, after it was sent', async () => {
    const user = userEvent.setup();
    const { chooser } = renderPicker();
    choose(chooser, [textFile('printer.log')]);
    await screen.findByRole('list', { name: '1 file to send' });
    act(() =>
      defined(uploads[0], 'the upload').finish({
        ok: true,
        file: { id: 'attachment-1', name: 'printer.log', size: 15 },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() =>
      expect(screen.queryByRole('list', { name: /to send$/ })).not.toBeInTheDocument(),
    );
  });
});
