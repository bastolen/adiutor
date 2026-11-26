/**
 * @file A highlighted line explaining a role, for invitation emails.
 */
import { Section, Text } from 'react-email';

import type { Role } from '@/lib/authz/roles';
import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';

import type { EmailColours } from './theme';

/**
 * The role's name and what it can do, in a soft panel, in the recipient's
 * language (the `roles` catalogue).
 *
 * @param props - Component props.
 * @param props.role - The role.
 * @param props.locale - The recipient's language.
 * @param props.colours - The email's colours (`emailColours(props.brand)`).
 */
export default function RoleSummary({
  role,
  locale,
  colours: colors,
}: {
  role: Role;
  locale: Locale;
  colours: EmailColours;
}) {
  const t = translator(locale, 'roles');
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
        <strong>{t(`${role}.label`)}</strong>
        <span style={{ color: colors.muted }}> · {t(`${role}.description`)}</span>
      </Text>
    </Section>
  );
}
