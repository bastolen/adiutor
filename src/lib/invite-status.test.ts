/**
 * @file Tests for invitation confirmation messages.
 */
import { describe, expect, it } from 'vitest';

import inviteStatusMessage from './invite-status';

describe('inviteStatusMessage', () => {
  it('describes each status', () => {
    expect(inviteStatusMessage('a@adiutor.test', 'sent')).toBe(
      'Invitation sent to a@adiutor.test.',
    );
    expect(inviteStatusMessage('a@adiutor.test', 'sent_existing_user')).toContain('already have');
    expect(inviteStatusMessage('a@adiutor.test', 'already_member')).toContain('already a member');
  });
});
