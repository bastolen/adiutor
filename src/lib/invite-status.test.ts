/**
 * @file Tests for invitation confirmation messages, in each language.
 */
import { describe, expect, it } from 'vitest';

import inviteStatusMessage from './invite-status';

describe('inviteStatusMessage', () => {
  it('describes each status', () => {
    expect(inviteStatusMessage('a@adiutor.test', 'sent', 'en-US')).toBe(
      'Invitation sent to a@adiutor.test.',
    );
    expect(inviteStatusMessage('a@adiutor.test', 'sent_existing_user', 'en-US')).toBe(
      'Invitation sent to a@adiutor.test. They already have an account.',
    );
    expect(inviteStatusMessage('a@adiutor.test', 'already_member', 'en-US')).toBe(
      "a@adiutor.test is already a member. We've emailed them to let them know.",
    );
  });

  it('says the company was added first when that sent the invitation', () => {
    expect(inviteStatusMessage('a@adiutor.test', 'sent', 'en-US', 'companyAdded')).toBe(
      'Company added. Invitation sent to a@adiutor.test.',
    );
    expect(
      inviteStatusMessage('a@adiutor.test', 'sent_existing_user', 'en-US', 'companyAdded'),
    ).toBe('Company added. Invitation sent to a@adiutor.test. They already have an account.');
  });

  it('speaks Dutch and Spanish, with the address where each language puts it', () => {
    expect(inviteStatusMessage('a@adiutor.test', 'already_member', 'nl-NL')).toBe(
      'a@adiutor.test is al lid. We hebben diegene een e-mail gestuurd om dat te laten weten.',
    );
    expect(inviteStatusMessage('a@adiutor.test', 'sent', 'es-ES', 'companyAdded')).toBe(
      'Empresa añadida. Invitación enviada a a@adiutor.test.',
    );
  });
});
