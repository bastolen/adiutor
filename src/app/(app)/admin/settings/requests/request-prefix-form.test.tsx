/**
 * @file Tests for the form that chooses the prefix of request numbers.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import renderInLocale from '../../../../../../tests/i18n/render';
import { saveRequestPrefixAction } from './actions';
import RequestPrefixForm from './request-prefix-form';

vi.mock('./actions', () => ({ saveRequestPrefixAction: vi.fn() }));

afterEach(() => {
  vi.mocked(saveRequestPrefixAction).mockReset();
});

describe('RequestPrefixForm', () => {
  it('shows the saved prefix, and a request’s number as it looks with it', () => {
    render(<RequestPrefixForm prefix="HELP" />);

    const field = screen.getByRole('textbox', { name: 'Prefix' });
    expect(field).toHaveValue('HELP');
    expect(field).toHaveAttribute('maxlength', '5');
    expect(field).toHaveAccessibleDescription('Requests are shown as HELP-142.');
  });

  it('saves what was typed, leaving the capitals to the server', async () => {
    vi.mocked(saveRequestPrefixAction).mockResolvedValue({ ok: true, message: 'Prefix saved.' });
    const user = userEvent.setup();
    render(<RequestPrefixForm prefix="AD" />);

    const field = screen.getByRole('textbox', { name: 'Prefix' });
    await user.clear(field);
    await user.type(field, 'req');
    await user.click(screen.getByRole('button', { name: 'Save prefix' }));

    await waitFor(() => expect(saveRequestPrefixAction).toHaveBeenCalledTimes(1));
    const formData = defined(vi.mocked(saveRequestPrefixAction).mock.calls[0], 'the call')[1];
    expect(formData.get('prefix')).toBe('req');
    expect(await screen.findByText('Prefix saved.')).toBeInTheDocument();
  });

  it('shows why a prefix was refused, and keeps what was typed', async () => {
    vi.mocked(saveRequestPrefixAction).mockResolvedValue({
      ok: false,
      message: 'Use one to five letters or digits for the prefix, starting with a letter, e.g. AD.',
    });
    const user = userEvent.setup();
    render(<RequestPrefixForm prefix="AD" />);

    const field = screen.getByRole('textbox', { name: 'Prefix' });
    await user.clear(field);
    await user.type(field, '1A');
    await user.click(screen.getByRole('button', { name: 'Save prefix' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Use one to five letters or digits');
    expect(field).toHaveValue('1A');
  });

  it.each([
    ['nl-NL', 'Voorvoegsel', 'Verzoeken worden getoond als AD-142.', 'Voorvoegsel opslaan'],
    ['es-ES', 'Prefijo', 'Las solicitudes se muestran como AD-142.', 'Guardar prefijo'],
  ] as const)('speaks %s', (locale, label, example, save) => {
    renderInLocale(locale, <RequestPrefixForm prefix="AD" />);

    expect(screen.getByRole('textbox', { name: label })).toHaveAccessibleDescription(example);
    expect(screen.getByRole('button', { name: save })).toBeInTheDocument();
  });
});
