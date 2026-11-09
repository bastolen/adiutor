/**
 * @file Tests for the invite action's result: a line per address and a
 * summary, in the request's language, with each refusal worded from the
 * service's error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { concurrentChangeError, ServiceError } from '@/server/errors';
import { type BulkInviteResult, inviteManyByEmail } from '@/server/people/invitations';

import { inviteAction } from './invitation-actions';
import { testLocale } from '../../../../tests/i18n/next-intl-mocks';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn() }));
vi.mock('@/server/people/invitations', () => ({
  inviteManyByEmail: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));
vi.mock('@/server/people/invite-links', () => ({
  createInviteLink: vi.fn(),
  revokeInviteLink: vi.fn(),
}));

/**
 * Builds the invite form for a company.
 *
 * @param emails - What was typed in the addresses field.
 * @returns The form data.
 */
function form(emails: string): FormData {
  const data = new FormData();
  data.set('companyId', '01890a5d-ac96-774b-bcce-b302099a8057');
  data.set('emails', emails);
  data.set('role', 'client');
  return data;
}

/**
 * Makes the service return these results.
 *
 * @param results - One per address.
 */
function serviceReturns(results: BulkInviteResult[]): void {
  vi.mocked(inviteManyByEmail).mockResolvedValue(results);
}

/** Three addresses: one sent, one over a limit, one that crossed another change. */
const mixed: BulkInviteResult[] = [
  { email: 'a@adiutor.test', ok: true, status: 'sent' },
  {
    email: 'b@adiutor.test',
    ok: false,
    error: new ServiceError('rate_limited', 'errors.tooManyAttempts', { minutes: 5 }),
  },
  { email: 'c@adiutor.test', ok: false, error: concurrentChangeError() },
];

beforeEach(() => {
  vi.mocked(getActor).mockResolvedValue({ id: 'admin-1' } as Awaited<ReturnType<typeof getActor>>);
  vi.mocked(inviteManyByEmail).mockReset();
});

describe('inviteAction', () => {
  it('gives one address its own message', async () => {
    serviceReturns([{ email: 'a@adiutor.test', ok: true, status: 'sent' }]);
    expect(await inviteAction(null, form('a@adiutor.test'))).toEqual({
      ok: true,
      message: 'Invitation sent to a@adiutor.test.',
    });

    serviceReturns([{ email: 'b@adiutor.test', ok: false, error: concurrentChangeError() }]);
    expect(await inviteAction(null, form('b@adiutor.test'))).toEqual({
      ok: false,
      message: 'Someone changed this at the same moment. Try again.',
    });
  });

  it('sums up several addresses, with a line for each', async () => {
    serviceReturns(mixed);
    expect(
      await inviteAction(null, form('a@adiutor.test, b@adiutor.test, c@adiutor.test')),
    ).toEqual({
      ok: true,
      message: 'Sent 1 of 3 invitations. Check the addresses below.',
      data: {
        lines: [
          { email: 'a@adiutor.test', ok: true, message: 'Invitation sent to a@adiutor.test.' },
          {
            email: 'b@adiutor.test',
            ok: false,
            message: 'Too many attempts. Try again in 5 minutes.',
          },
          {
            email: 'c@adiutor.test',
            ok: false,
            message: 'Someone changed this at the same moment. Try again.',
          },
        ],
      },
    });

    serviceReturns([
      { email: 'a@adiutor.test', ok: true, status: 'sent' },
      { email: 'b@adiutor.test', ok: true, status: 'sent' },
    ]);
    expect(await inviteAction(null, form('a@adiutor.test, b@adiutor.test'))).toMatchObject({
      ok: true,
      message: 'Sent 2 invitations.',
    });
  });

  it.each([
    [
      'nl-NL',
      // Dutch names the total before the number sent.
      'Van de 3 uitnodigingen is er 1 verstuurd. Controleer de adressen hieronder.',
      'Uitnodiging verstuurd naar a@adiutor.test.',
      'Te veel pogingen. Probeer het over 5 minuten opnieuw.',
    ],
    [
      'es-ES',
      'De 3 invitaciones, se ha enviado 1. Revisa las direcciones de abajo.',
      'Invitación enviada a a@adiutor.test.',
      'Demasiados intentos. Vuelve a intentarlo dentro de 5 minutos.',
    ],
  ] as const)('speaks the request’s language (%s)', async (locale, summary, sent, limited) => {
    testLocale.current = locale;
    serviceReturns(mixed);

    const result = await inviteAction(null, form('a@adiutor.test, b@adiutor.test, c@adiutor.test'));

    expect(result).toMatchObject({ ok: true, message: summary });
    expect(result.ok && result.data?.lines.map((line) => line.message).slice(0, 2)).toEqual([
      sent,
      limited,
    ]);
  });

  it('words a refusal of the whole list in the request’s language', async () => {
    testLocale.current = 'es-ES';
    vi.mocked(inviteManyByEmail).mockRejectedValue(
      new ServiceError('invalid', 'validation.emailList.tooMany', { max: 20 }),
    );

    expect(await inviteAction(null, form('a@adiutor.test'))).toEqual({
      ok: false,
      message:
        'Puedes invitar como máximo a 20 personas a la vez. Divide la lista y vuelve a intentarlo.',
    });
  });
});
