/**
 * @file Tests for the Add company form: the URL name follows the company
 * name until it's edited, the whole draft survives leaving the page and
 * coming back, and a registered company's draft is cleared.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Activity, type ReactNode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import RegisterCompanyForm from './register-company-form';

vi.mock('next/navigation', () => ({
  /**
   * Mocked router (the recent confirmation check uses it).
   *
   * @returns A router whose `push` does nothing.
   */
  useRouter: () => ({ push: vi.fn() }),
}));

/** Mocked server action. */
const { registerCompanyAction } = vi.hoisted(() => ({ registerCompanyAction: vi.fn() }));

vi.mock('./actions', () => ({ default: registerCompanyAction }));

/**
 * Wraps content in an `<Activity>` that a "Leave" / "Return" button hides and
 * shows, like Next.js does with a page when you navigate away and back.
 *
 * @param props - Harness props.
 * @param props.children - The page content.
 * @returns The harness.
 */
function Page({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setVisible((value) => !value)}>
        {visible ? 'Leave' : 'Return'}
      </button>
      <Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity>
    </>
  );
}

describe('RegisterCompanyForm', () => {
  beforeEach(() => {
    registerCompanyAction.mockReset();
  });

  it('suggests the URL name from the company name until it is edited', async () => {
    const user = userEvent.setup();
    render(<RegisterCompanyForm defaultLocale="en-US" />);

    await user.type(screen.getByLabelText('Company name'), 'Adiutor Tests');
    expect(screen.getByLabelText('URL name')).toHaveValue('adiutor-tests');

    await user.clear(screen.getByLabelText('URL name'));
    await user.type(screen.getByLabelText('URL name'), 'tests');
    await user.type(screen.getByLabelText('Company name'), ' Paging');
    expect(screen.getByLabelText('URL name')).toHaveValue('tests');
  });

  it('keeps the whole draft when the page is left and shown again', async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <RegisterCompanyForm defaultLocale="en-US" />
      </Page>,
    );

    await user.type(screen.getByLabelText('Company name'), 'Adiutor Tests');
    await user.clear(screen.getByLabelText('URL name'));
    await user.type(screen.getByLabelText('URL name'), 'tests');
    await user.type(screen.getByLabelText("Email of the company's admin"), 'admin@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(screen.getByLabelText('Company name')).toHaveValue('Adiutor Tests');
    expect(screen.getByLabelText('URL name')).toHaveValue('tests');
    expect(screen.getByLabelText("Email of the company's admin")).toHaveValue('admin@adiutor.test');
    // The URL name was edited by hand, and still doesn't follow the company name.
    await user.type(screen.getByLabelText('Company name'), ' Paging');
    expect(screen.getByLabelText('URL name')).toHaveValue('tests');
  });

  it('keeps the draft when registering is refused', async () => {
    const user = userEvent.setup();
    registerCompanyAction.mockResolvedValue({
      ok: false,
      message: 'That URL name is already in use.',
    });
    render(<RegisterCompanyForm defaultLocale="en-US" />);

    await user.type(screen.getByLabelText('Company name'), 'Adiutor Tests');
    await user.type(screen.getByLabelText("Email of the company's admin"), 'admin@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Add company' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That URL name is already in use.');
    expect(screen.getByLabelText('Company name')).toHaveValue('Adiutor Tests');
    expect(screen.getByLabelText('URL name')).toHaveValue('adiutor-tests');
    expect(screen.getByLabelText("Email of the company's admin")).toHaveValue('admin@adiutor.test');
  });

  it('starts empty again after a company is registered', async () => {
    const user = userEvent.setup();
    registerCompanyAction.mockResolvedValue({
      ok: true,
      message: 'Adiutor Tests is added and admin@adiutor.test is invited.',
      data: { companyId: 'company-1', slug: 'adiutor-tests' },
    });
    render(
      <Page>
        <RegisterCompanyForm defaultLocale="en-US" />
      </Page>,
    );

    await user.type(screen.getByLabelText('Company name'), 'Adiutor Tests');
    await user.type(screen.getByLabelText("Email of the company's admin"), 'admin@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Add company' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Adiutor Tests is added');
    expect(screen.getByRole('link', { name: 'Open the company' })).toHaveAttribute(
      'href',
      '/companies/adiutor-tests/members',
    );
    const formData = defined(registerCompanyAction.mock.calls[0], 'the first call')[1] as FormData;
    expect(formData.get('name')).toBe('Adiutor Tests');
    expect(formData.get('slug')).toBe('adiutor-tests');

    // The confirmation doesn't outlive the page; the form that returns is a fresh one.
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Company name')).toHaveValue('');
    expect(screen.getByLabelText('URL name')).toHaveValue('');
    expect(screen.getByLabelText("Email of the company's admin")).toHaveValue('');
    // The URL name follows the company name again.
    await user.type(screen.getByLabelText('Company name'), 'Adiutor');
    expect(screen.getByLabelText('URL name')).toHaveValue('adiutor');
  });
});
