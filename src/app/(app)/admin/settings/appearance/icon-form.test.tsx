/**
 * @file Tests for the browser tab icon form: the icon as it is and where it
 * comes from, a chosen file's preview, the refusal of no file, and removing
 * only an own icon.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StaffNameProvider } from '@/components/brand/staff-name';

import { uploadBrandImageAction } from './actions';
import IconForm from './icon-form';

vi.mock('./actions', () => ({
  default: vi.fn(),
  uploadBrandImageAction: vi.fn(),
  removeBrandImageAction: vi.fn(),
}));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:chosen');
  URL.revokeObjectURL = vi.fn();
  vi.mocked(uploadBrandImageAction).mockReset();
});

/**
 * The addresses of the icons shown, the tab's first.
 *
 * @param container - The rendered form.
 * @returns Their addresses.
 */
function shownIcons(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('img')].map((image) => image.getAttribute('src'));
}

describe('IconForm', () => {
  it('shows Adiutor’s icon until a logo or an icon is uploaded, with nothing to remove', () => {
    const { container } = render(<IconForm icon={null} ownIcon={false} />);

    expect(shownIcons(container)).toEqual(['/brand/icon.svg', '/brand/icon.svg']);
    expect(
      screen.getByText('Adiutor’s icon, until a logo or an icon is uploaded.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove uploaded icon' })).not.toBeInTheDocument();
  });

  it('shows the icon made from the brand at both sizes, and says it’s the staff’s initials', () => {
    const { container } = render(
      <StaffNameProvider name="Adiutor Tests Support">
        <IconForm icon={{ version: 'abc', source: 'initials' }} ownIcon={false} />
      </StaffNameProvider>,
    );

    expect(shownIcons(container)).toEqual([
      '/branding/icon?v=abc',
      '/branding/icon?size=180&v=abc',
    ]);
    expect(
      screen.getByText(
        'The initials of Adiutor Tests Support on the accent colour, as the logo is wide.',
      ),
    ).toBeInTheDocument();
  });

  it('offers to remove an own icon', () => {
    render(<IconForm icon={{ version: 'abc', source: 'icon' }} ownIcon />);

    expect(screen.getByText('The uploaded icon.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove uploaded icon' })).toBeInTheDocument();
  });

  it('previews a chosen file, and refuses to upload without one', async () => {
    const user = userEvent.setup();
    const { container } = render(<IconForm icon={null} ownIcon={false} />);

    await user.click(screen.getByRole('button', { name: 'Upload icon' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an image first.');
    expect(uploadBrandImageAction).not.toHaveBeenCalled();

    await user.upload(
      screen.getByLabelText('Own icon', { selector: 'input' }),
      new File([new Uint8Array(64)], 'icon.png', { type: 'image/png' }),
    );
    expect(shownIcons(container)).toEqual(['blob:chosen', 'blob:chosen']);
    expect(screen.getByText('The chosen icon, not uploaded yet.')).toBeInTheDocument();
  });
});
