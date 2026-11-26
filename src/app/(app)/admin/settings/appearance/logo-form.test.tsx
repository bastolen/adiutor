/**
 * @file Tests for the logo form: the preview (Adiutor's logo, the uploaded
 * one, or the chosen file), the files the browser refuses before sending,
 * uploading, and removing only an uploaded logo.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NO_BRAND_COLOURS } from '@/lib/branding';

import { uploadBrandImageAction } from './actions';
import LogoForm from './logo-form';

vi.mock('./actions', () => ({
  default: vi.fn(),
  uploadBrandImageAction: vi.fn(),
  removeBrandImageAction: vi.fn(),
}));

/** An uploaded logo. */
const LOGO = { src: '/branding/logo?v=logo-1', width: 280, height: 64 };

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:chosen');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.mocked(uploadBrandImageAction).mockReset();
});

/**
 * The image a preview panel shows.
 *
 * @param mode - The panel.
 * @returns Its address.
 */
function previewed(mode: 'light' | 'dark'): string | null {
  return screen.getByTestId(`logo-${mode}`).querySelector('img')?.getAttribute('src') ?? null;
}

/**
 * A file as the browser gives it.
 *
 * @param type - Its media type.
 * @param size - Its size in bytes.
 * @returns The file.
 */
function file(type = 'image/png', size = 2048): File {
  return new File([new Uint8Array(size)], type === 'image/png' ? 'logo.png' : 'logo.svg', {
    type,
  });
}

describe('LogoForm', () => {
  it('previews Adiutor’s logo in each mode until one is uploaded, with nothing to remove', () => {
    render(<LogoForm logo={null} colours={NO_BRAND_COLOURS} />);

    expect(previewed('light')).toBe('/brand/logo.svg');
    expect(previewed('dark')).toBe('/brand/logo-on-dark.svg');
    expect(screen.getByText('Adiutor’s logo shows until one is uploaded.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument();
  });

  it('previews the uploaded logo in both modes, which can be removed', () => {
    render(<LogoForm logo={LOGO} colours={NO_BRAND_COLOURS} />);

    expect(previewed('light')).toBe(LOGO.src);
    expect(previewed('dark')).toBe(LOGO.src);
    expect(screen.getByRole('button', { name: 'Remove logo' })).toBeInTheDocument();
  });

  it('previews a chosen file before it’s uploaded', async () => {
    const user = userEvent.setup();
    render(<LogoForm logo={LOGO} colours={NO_BRAND_COLOURS} />);

    await user.upload(screen.getByLabelText('Logo image'), file());

    expect(previewed('light')).toBe('blob:chosen');
    expect(screen.getByText('The chosen image, not uploaded yet.')).toBeInTheDocument();
  });

  it.each([
    ['no file', null, 'Choose an image first.'],
    ['an empty file', file('image/png', 0), 'That file is empty.'],
    ['a file over 1 MB', file('image/png', 1024 * 1024 + 1), 'That image is too large'],
    ['an SVG', file('image/svg+xml'), 'Choose a PNG or JPEG image.'],
  ])('refuses %s without sending it', async (_, chosen, message) => {
    const user = userEvent.setup({ applyAccept: false });
    render(<LogoForm logo={null} colours={NO_BRAND_COLOURS} />);
    if (chosen) {
      await user.upload(screen.getByLabelText('Logo image'), chosen);
    }

    await user.click(screen.getByRole('button', { name: 'Upload logo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(uploadBrandImageAction).not.toHaveBeenCalled();
  });

  it('uploads the chosen file as the logo, then empties the form', async () => {
    vi.mocked(uploadBrandImageAction).mockResolvedValue({ ok: true, message: 'Logo uploaded.' });
    const user = userEvent.setup();
    render(<LogoForm logo={null} colours={NO_BRAND_COLOURS} />);
    await user.upload(screen.getByLabelText('Logo image'), file());
    await user.click(screen.getByRole('button', { name: 'Upload logo' }));

    await waitFor(() => expect(uploadBrandImageAction).toHaveBeenCalledTimes(1));
    const [, sent] = vi.mocked(uploadBrandImageAction).mock.calls[0] ?? [];
    expect(sent?.get('kind')).toBe('logo');
    // jsdom's form data doesn't hold files set by user-event; the end-to-end test sends a real one.
    expect(sent?.has('file')).toBe(true);
    // The form was reset: the preview shows the logo as saved again.
    await waitFor(() => expect(previewed('light')).toBe('/brand/logo.svg'));
    expect(screen.queryByText('The chosen image, not uploaded yet.')).not.toBeInTheDocument();
  });
});
