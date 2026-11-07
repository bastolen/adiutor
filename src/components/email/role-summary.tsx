/**
 * @file A highlighted line explaining a role, for invitation emails.
 */
import { Section, Text } from 'react-email';

import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '@/lib/authz/roles';

import { colors } from './theme';

/**
 * The role's name and what it can do, in a soft panel.
 *
 * @param props - Component props.
 * @param props.role - The role.
 * @returns The panel.
 */
export default function RoleSummary({ role }: { role: Role }) {
  return (
    <Section
      style={{
        margin: '0 0 24px',
        padding: '12px 16px',
        backgroundColor: colors.background,
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
      }}
    >
      <Text style={{ margin: 0, color: colors.foreground, fontSize: '14px', lineHeight: '22px' }}>
        <strong>{ROLE_LABELS[role]}</strong>
        <span style={{ color: colors.muted }}> · {ROLE_DESCRIPTIONS[role]}</span>
      </Text>
    </Section>
  );
}
