/**
 * @file Tests for saving a company's details: it refreshes, also before it
 * follows a new URL name to the company's new address, so the pages Next
 * kept alive under the old one are dropped.
 */
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { updateCompany } from '@/server/people/companies';

import { updateCompanyAction } from './actions';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn() }));
vi.mock('@/server/people/companies', () => ({ setCompanyActive: vi.fn(), updateCompany: vi.fn() }));

/** The company's Admin. */
const admin = { id: 'admin-1' } as Awaited<ReturnType<typeof getActor>>;

/** The company being changed. */
const COMPANY_ID = '01890a5d-ac96-774b-bcce-b302099a8057';

/**
 * Builds the settings form.
 *
 * @param slug - The URL name typed into it.
 * @returns The form data.
 */
function form(slug: string): FormData {
  const data = new FormData();
  Object.entries({ companyId: COMPANY_ID, name: 'Adiutor Tests', slug }).forEach(([name, value]) =>
    data.set(name, value),
  );
  return data;
}

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(redirect).mockClear();
  vi.mocked(updateCompany).mockReset();
  vi.mocked(getActor).mockResolvedValue(admin);
});

describe('updateCompanyAction', () => {
  it('refreshes, then follows a new URL name to the new address', async () => {
    vi.mocked(updateCompany).mockResolvedValue({ slug: 'adiutor-tests-moved', slugChanged: true });

    await expect(updateCompanyAction(null, form('adiutor-tests-moved'))).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(redirect).toHaveBeenCalledExactlyOnceWith(
      '/companies/adiutor-tests-moved/settings?saved=1',
    );
    // A redirect alone would leave the pages kept alive, with the old name and address.
    expect(refresh).toHaveBeenCalledBefore(vi.mocked(redirect));
  });

  it('refreshes and confirms in place when the URL name stays', async () => {
    vi.mocked(updateCompany).mockResolvedValue({ slug: 'adiutor-tests', slugChanged: false });

    expect(await updateCompanyAction(null, form('adiutor-tests'))).toEqual({
      ok: true,
      message: 'Saved.',
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('says why a change was refused, without refreshing', async () => {
    vi.mocked(updateCompany).mockRejectedValue(new ServiceError('forbidden', 'errors.forbidden'));

    expect(await updateCompanyAction(null, form('adiutor-tests'))).toEqual({
      ok: false,
      message: "You don't have permission to do that.",
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
